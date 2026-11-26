// Vista móvil: hojas inferiores, teclado, aprobaciones, pestaña Teléfono y utilidades del iPhone.
// Convive con main.js (que maneja orbe, voz y paneles). Todo texto del servidor se inserta con textContent.
import { api, getToken, getConnect, runTool, googleStart } from "./api.js";
import { store, setState } from "./state.js";
import { showApproval } from "./panels.js";
import { proAbrir, proCerrar, proElegir } from "./movil-pro.js";
import { initAccionesPc, refrescarAccionesPc } from "./acciones-pc.js";

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const body = document.body;
const safe = (fn) => { try { return fn(); } catch { /* API no disponible */ } };
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

/* ---------- hojas inferiores (una sola abierta) ---------- */
const sheets = { cola: $("sh-cola"), tel: $("sh-tel"), musica: $("sh-musica"), estado: $("sh-estado"), mas: $("sh-mas"), pro: $("sh-pro"), estudiar: $("sh-estudiar"), chats: $("sh-chats") };
const EN_MAS = new Set(["cola", "tel", "musica", "estado"]);
let current = null;
const avisarVista = (vista) => window.dispatchEvent(new CustomEvent("jarvis:vista", { detail: { vista } })); // chats.js y estudiar.js cargan al abrirse

function closeSheet() {
  if (!current) return;
  if (current === "pro") proCerrar();
  const s = sheets[current]; current = null;
  s.classList.remove("on"); s.style.transform = "";
  $("scrim").classList.remove("on");
  document.querySelectorAll(".dock [data-open]").forEach((b) => b.classList.remove("on"));
  setTimeout(() => { if (!s.classList.contains("on")) s.hidden = true; if (!current) $("scrim").hidden = true; }, 260);
  avisarVista("clasico");
}
function openSheet(name) {
  closeKeyboard();
  if (current === name) return closeSheet();
  if (current) { if (current === "pro") proCerrar(); const prev = sheets[current]; prev.classList.remove("on"); prev.hidden = true; }
  current = name;
  const s = sheets[name];
  s.hidden = false; s.style.transform = "";
  $("scrim").hidden = false;
  void s.offsetHeight; // reflujo para que corra la transición
  s.classList.add("on"); $("scrim").classList.add("on");
  document.querySelectorAll(".dock [data-open]").forEach((b) => b.classList.toggle("on", b.dataset.open === name || (b.dataset.open === "mas" && EN_MAS.has(name))));
  avisarVista(name);
  if (name === "tel") { loadEscenas(); loadPhone(); refrescarAccionesPc(); }
  if (name === "cola") { loadPhone(); }
  if (name === "mas") { renderMas(); window.dispatchEvent(new CustomEvent("jarvis:mas")); }
  if (name === "musica") abrirMusica();
  if (name === "pro") proAbrir();
}

// Cerrar deslizando el asa hacia abajo
for (const s of Object.values(sheets)) {
  const grip = s.querySelector(".grip");
  let y0 = null, dy = 0, t0 = 0;
  grip.addEventListener("pointerdown", (e) => { y0 = e.clientY; dy = 0; t0 = e.timeStamp; s.classList.add("drag"); grip.setPointerCapture(e.pointerId); });
  grip.addEventListener("pointermove", (e) => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); s.style.transform = `translateY(${dy}px)`; });
  const end = (e) => {
    if (y0 == null) return;
    const fast = dy / Math.max(1, e.timeStamp - t0) > 0.5;
    y0 = null; s.classList.remove("drag");
    if (dy > 80 || (fast && dy > 20)) closeSheet(); else s.style.transform = "";
  };
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
  grip.addEventListener("click", () => { if (dy < 5) closeSheet(); }); // un toque en el asa también cierra
}
$("scrim").addEventListener("click", closeSheet);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeSheet(); closeKeyboard(); } });

document.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openSheet(b.dataset.open)));

/* ---------- teclado: la barra de entrada sube con el teclado (visualViewport) ---------- */
function closeKeyboard() { safe(() => $("sayin").blur()); }
function syncKb() {
  const vv = window.visualViewport;
  if (!vv) return;
  const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  root.style.setProperty("--kb", kb + "px");
  body.classList.toggle("kbopen", kb > 100);
  if (kb > 100) window.scrollTo(0, 0);
}
safe(() => { window.visualViewport.addEventListener("resize", syncKb); window.visualViewport.addEventListener("scroll", syncKb); });
$("sayform").addEventListener("submit", () => setTimeout(closeKeyboard, 0));
for (const id of ["orb", "saymic"]) $(id).addEventListener("click", () => { closeKeyboard(); closeSheet(); }, true);
// "Abrir en Pro" (#pro/<id>) bajo un mensaje.
function abrirProDeHash() {
  const m = /^#pro\/(\d+)$/.exec(location.hash);
  if (!m || !getToken()) return;
  history.replaceState(null, "", location.pathname + location.search); // así el mismo enlace vuelve a funcionar
  proElegir(Number(m[1]));
  if (current !== "pro") openSheet("pro");
}
window.addEventListener("hashchange", abrirProDeHash);
setTimeout(abrirProDeHash, 800);

/* ---------- hoja Control: pestañas iPhone / PC ---------- */
initAccionesPc({ visible: () => current === "tel" && !$("ctab-pc").hidden });
document.querySelectorAll("#sh-tel .tabs [data-ctab]").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("#sh-tel .tabs [data-ctab]").forEach((x) => x.classList.toggle("on", x === b));
  $("ctab-ios").hidden = b.dataset.ctab !== "ios"; $("ctab-pc").hidden = b.dataset.ctab !== "pc";
  if (b.dataset.ctab === "pc") refrescarAccionesPc();
}));

/* ---------- pestañas de la hoja Cola ---------- */
document.querySelectorAll("#sh-cola .tabs [data-tab]").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("#sh-cola .tabs [data-tab]").forEach((x) => x.classList.toggle("on", x === b));
  $("tab-pc").hidden = b.dataset.tab !== "pc"; $("tab-tel").hidden = b.dataset.tab !== "tel";
}));
function syncColaBadge() {
  const n = Number($("qcount").textContent) || 0;
  const b = $("colabadge"); b.textContent = n; b.hidden = !n;
}
new MutationObserver(syncColaBadge).observe($("qcount"), { childList: true, characterData: true, subtree: true });

/* ---------- aprobaciones: globo, insignia y hoja ámbar ---------- */
let pending = [];
function paintBadge() {
  const n = pending.length;
  const c = $("apcount"); c.textContent = n; c.hidden = !n;
  $("apbtn").classList.toggle("has", n > 0);
  safe(() => { if (n) navigator.setAppBadge?.(n); else navigator.clearAppBadge?.(); });
}
async function refreshApprovals() {
  if (!getToken()) return;
  try { pending = (await api("/approvals")).approvals || []; } catch { return; }
  paintBadge();
  if (pending[0] && !store.approval) presentApproval(pending[0]);
}
function presentApproval(a) { store.approval = a; showApproval(a); setState("permiso"); }
$("apbtn").addEventListener("click", async () => { await refreshApprovals(); if (!pending.length) { closeSheet(); } });
// Cuando la tarjeta se cierra (aprobar o rechazar) se mira si queda otra pendiente.
new MutationObserver(() => { if (!$("perm").classList.contains("show")) setTimeout(refreshApprovals, 150); }).observe($("perm"), { attributes: true, attributeFilter: ["class"] });
setInterval(refreshApprovals, 30000);
window.addEventListener("jarvis:ws", (ev) => {
  const m = ev.detail;
  if (m.type === "approval.request") {
    refreshApprovals();
    if (document.hidden) safe(() => { if (Notification.permission === "granted") new Notification("Jarvis pide permiso", { body: m.approval?.summary || "Hay una acción pendiente" }); });
  } else if (m.type === "approval.resolved") refreshApprovals();
  else if (m.type === "nav.inicio") { if (current === "estudiar") closeSheet(); } // deja ver "En vivo"
  else if (m.type === "phone.update") { if (current === "tel" || current === "cola") loadPhone(); else phoneCounts(); }
});
// Tras iniciar sesión (o al abrir con sesión guardada) se cargan los pendientes.
new MutationObserver(() => { if ($("login").hidden) refreshApprovals(); }).observe($("login"), { attributes: true, attributeFilter: ["hidden"] });
setTimeout(refreshApprovals, 1500);

/* ---------- Más: notificaciones, vista escritorio, dispositivos ---------- */
function renderMas() {
  renderGoogle();
  renderDespertador();
  const supported = "Notification" in window;
  const b = $("mnotif");
  b.hidden = false; // sin soporte (p. ej. Safari sin instalar) el toque explica cómo instalar
  if (supported) b.textContent = Notification.permission === "granted" ? "Notificaciones activadas" : Notification.permission === "denied" ? "Notificaciones bloqueadas (ajustes de iOS)" : "Activar notificaciones";
}
// Web Push: iOS exige un toque del usuario y la app instalada en la pantalla de inicio (iOS 16.4+).
const b64ToU8 = (s) => { const p = "=".repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };
function pushMsg(t) { const m = $("mpushmsg"); m.textContent = t; m.hidden = !t; }
async function activarPush() {
  const instalada = navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return pushMsg(instalada ? "Este navegador no admite notificaciones push." : "Instale Jarvis: Compartir, Añadir a pantalla de inicio, y ábralo desde el icono (iOS 16.4 o superior).");
  }
  if (!instalada) return pushMsg("Instale Jarvis: Compartir, Añadir a pantalla de inicio, y ábralo desde el icono.");
  try {
    if ((await Notification.requestPermission()) !== "granted") return pushMsg("Permiso denegado. Actívelo en Ajustes de iOS, Notificaciones, Jarvis.");
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await api("/push/vapid");
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(publicKey) });
    await api("/push/subscribe", { method: "POST", body: { subscription: sub.toJSON() } });
    pushMsg("Notificaciones activadas.");
  } catch (e) { pushMsg("No se pudo activar: " + (e.message || "error")); }
}
$("mnotif").addEventListener("click", async () => { await activarPush(); renderMas(); });
async function renderDespertador() {
  const d = $("mdesp");
  try { d.textContent = "Despertador del Atajo: " + ((await api("/phone/despertador")).configurado ? "sí, configurado" : "no (falta PHONE_NUDGE_EMAIL o conectar Gmail)"); }
  catch { d.textContent = "Despertador del Atajo: no disponible"; }
}
// Abrir desde una notificación: /m#aprobacion-<id> muestra la tarjeta pendiente.
window.addEventListener("hashchange", () => { if (/^#aprobacion-/.test(location.hash)) refreshApprovals(); });
if (/^#aprobacion-/.test(location.hash)) setTimeout(refreshApprovals, 800);
$("mdesk").addEventListener("click", () => {
  safe(() => localStorage.setItem("jarvis_vista", "escritorio"));
  location.href = "/";
});
$("mdev").addEventListener("click", async () => {
  const p = $("devpanel"); p.hidden = !p.hidden;
  if (!p.hidden) loadDevices();
});
async function loadDevices() {
  const box = $("devlist"); box.replaceChildren();
  try {
    const { devices } = await api("/devices");
    for (const d of devices.filter((x) => !x.revoked_at)) {
      const row = el("div", "dev");
      const t = el("div"); t.append(document.createTextNode(`${d.name} · ${d.kind}${d.actual ? " (este)" : ""}`), el("small", "", d.last_seen ? "visto " + new Date(Number(d.last_seen)).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "sin uso"));
      row.append(t);
      if (!d.actual) { const b = el("button", "", "Revocar"); b.type = "button"; b.onclick = async () => { try { await api(`/devices/${d.id}`, { method: "DELETE" }); } catch { /* ya revocado */ } loadDevices(); }; row.append(b); }
      box.append(row);
    }
  } catch { box.append(el("div", "empty", "No pude cargar los dispositivos.")); }
}
// Dos claves distintas: "phone" (Atajo Jarvis Puente) y "shortcut" (Atajo Jarvis, para hablarle).
async function crearClave(name, kind) {
  const t = $("devtoken");
  try {
    const out = await api("/devices", { method: "POST", body: { name, kind } });
    t.textContent = out.token; t.hidden = false;
    $("devmsg").textContent = "cópielo ahora: no se vuelve a mostrar";
    loadDevices();
  } catch { t.textContent = "No pude crear el token."; t.hidden = false; }
}
$("devnew").addEventListener("click", () => crearClave("iPhone (Atajo)", "phone"));
$("devvoz").addEventListener("click", () => crearClave("iPhone (hablar con Jarvis)", "shortcut"));

/* ---------- Teléfono: cola de acciones para el iPhone ---------- */
const TILES = [
  ["Linterna", "encender", { accion: "linterna", valor: "on" }], ["Linterna", "apagar", { accion: "linterna", valor: "off" }], ["Batería", "", { accion: "bateria" }],
  ["No molestar", "1 hora", { accion: "no_molestar", valor: "on", minutos: 60 }], ["No molestar", "apagar", { accion: "no_molestar", valor: "off" }], ["Vibrar", "", { accion: "vibrar" }],
  ["Bluetooth", "encender", { accion: "bluetooth", valor: "on" }], ["Bluetooth", "apagar", { accion: "bluetooth", valor: "off" }], ["Bajo consumo", "encender", { accion: "bajo_consumo", valor: "on" }],
  ["Modo oscuro", "encender", { accion: "modo_oscuro", valor: "on" }], ["Modo oscuro", "apagar", { accion: "modo_oscuro", valor: "off" }], ["Pausa", "música", { accion: "multimedia", valor: "pausa" }],
  ["Play", "música", { accion: "multimedia", valor: "play" }], ["Siguiente", "canción", { accion: "multimedia", valor: "siguiente" }], ["Wi-Fi", "apagar", { accion: "wifi", valor: "off" }],
  ["Modo avión", "encender", { accion: "modo_avion", valor: "on" }], ["Portapapeles", "leer", { accion: "leer_portapapeles" }], ["WhatsApp", "abrir", { accion: "abrir_app", valor: "WhatsApp" }],
  ["Temporizador", "5 min", { accion: "temporizador", valor: 5 }], ["Temporizador", "10 min", { accion: "temporizador", valor: 10 }], ["Estado", "iPhone", { accion: "estado" }],
  ["Hacer sonar", "iPhone", { accion: "buscar_iphone" }], ["Notificación", "de prueba", { accion: "notificacion", valor: "Aviso de Jarvis" }],
];
// Botones según las listas del servidor (enfoques y atajos permitidos).
let enfoques = [], atajos = [];
const tilesExtra = () => [
  ...enfoques.flatMap((n) => [[n, "activar", { accion: "enfoque", valor: n, activar: "on" }], [n, "desactivar", { accion: "enfoque", valor: n, activar: "off" }]]),
  ...atajos.map((n) => [n, "atajo", { accion: "atajo", valor: n }]),
];
let catalogo = {};
const needsApproval = (spec) => {
  const d = catalogo[spec.accion];
  return !!d && (d.modo === "aprobacion" || (d.aprobacion_valores || []).includes(spec.valor));
};
const ESTADO = { aprobacion: "espera su OK", lista: "lista", entregada: "enviada", hecha: "hecha", fallida: "falló", rechazada: "rechazada", caducada: "caducó" };

function say(msg) { $("phmsg").textContent = msg; setTimeout(() => { if ($("phmsg").textContent === msg) $("phmsg").textContent = ""; }, 4000); }
async function sendPhone(spec) {
  try {
    const out = await api("/phone/actions", { method: "POST", body: spec });
    say(out.action.status === "aprobacion" ? "pide su aprobación" : "en cola");
    window.dispatchEvent(new CustomEvent("jarvis:respuesta", { detail: out }));
  } catch (e) { say("no se pudo: " + (e.data?.error || e.message)); }
  loadPhone();
}
function renderTiles() {
  const g = $("phgrid"); if (g.childElementCount) return;
  for (const [t, sub, spec] of [...TILES, ...tilesExtra()]) {
    const b = el("button", needsApproval(spec) ? "ask" : "", t); b.type = "button";
    const s = needsApproval(spec) ? "pide OK" : sub;
    if (s) b.append(el("small", "", s));
    if (needsApproval(spec) && sub) b.title = sub;
    b.onclick = () => sendPhone(spec);
    g.append(b);
  }
}
function renderHist(items) {
  for (const box of [$("phhist"), $("phqueue")]) {
    box.replaceChildren();
    if (!items.length) { box.append(el("div", "empty", "Sin acciones todavía.")); continue; }
    for (const a of items.slice(0, 15)) {
      const row = el("div", "ph");
      const v = a.args && a.args.valor !== undefined ? ` ${a.args.valor}` : "";
      row.append(el("span", "", a.nombre + v), el("small", "st-" + a.status, `${ESTADO[a.status] || a.status} · ${new Date(a.created_at).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}`));
      box.append(row);
    }
  }
}
function paintPhoneCount(n) {
  $("phn").textContent = n; $("qtelcount").textContent = n;
  $("phrun").classList.toggle("vacio", !n);
}
async function phoneCounts() {
  if (!getToken()) return;
  try { const c = (await api("/phone/actions")).pendientes || {}; paintPhoneCount(c.lista || 0); } catch { /* sin red */ }
}
async function loadPhone() {
  if (!getToken()) return;
  try {
    const r = await api("/phone/actions");
    catalogo = Object.fromEntries(r.catalogo.map((c) => [c.id, c]));
    enfoques = r.enfoques || []; atajos = r.atajos || [];
    $("phrun").href = `shortcuts://run-shortcut?name=${encodeURIComponent(r.atajo || "Jarvis Puente")}`;
    renderTiles(); renderHist(r.acciones); paintPhoneCount(r.pendientes.lista || 0);
  } catch { $("phmsg").textContent = "sin conexión"; }
}
for (const [id, accion] of [["phbri", "brillo"], ["phvol", "volumen"]]) {
  $(id).addEventListener("input", () => { $(id + "o").textContent = $(id).value; });
  $(id + "b").addEventListener("click", () => sendPhone({ accion, valor: Number($(id).value) }));
}
$("phsay").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = $("phsayin").value.trim(); if (!t) return;
  $("phsayin").value = "";
  sendPhone({ accion: "decir", valor: t });
});

syncColaBadge();

/* ---------- Escenas (hoja Control) ---------- */
const escMsg = (t) => { $("escmsg").textContent = t || ""; };
async function lanzarEscena(id, boton) {
  boton.disabled = true; escMsg("Lanzando…");
  try {
    const out = await api(`/escenas/${encodeURIComponent(id)}`, { method: "POST", body: {} });
    escMsg(out.resumen);
    window.dispatchEvent(new CustomEvent("jarvis:respuesta", { detail: out }));
  }
  catch (e) { escMsg("No se pudo: " + (e.data?.error || e.message)); }
  boton.disabled = false;
  loadPhone(); refrescarAccionesPc();
}
async function loadEscenas() {
  const g = $("escgrid");
  if (!getToken() || g.childElementCount) return;
  try {
    const { escenas } = await api("/escenas");
    g.replaceChildren(...escenas.map((x) => {
      const b = el("button", "", x.nombre); b.type = "button";
      b.append(el("small", "", `${x.pasos} pasos`));
      b.onclick = () => lanzarEscena(x.id, b);
      return b;
    }));
  } catch { escMsg("No pude cargar las escenas."); }
}

/* ---------- Música: buscador, playlists y conexión con Google ---------- */
let yt = { disponible: false, permiso: false, unidades_hoy: 0, tope: 0 };
const primeraLista = (o) => (o && (["items", "resultados", "videos", "playlists", "listas"].map((k) => o[k]).find(Array.isArray) || Object.values(o).find(Array.isArray))) || [];
const musMsg = (t) => { $("musmsg").textContent = t || ""; };
async function cargarConnect() {
  try { const c = await getConnect(); yt = c.youtube || yt; } catch { /* sin red */ }
  $("muscuota").textContent = yt.tope ? `${yt.unidades_hoy} / ${yt.tope} unidades hoy` : "";
  return yt;
}
function filaMusica(titulo, sub, fn) {
  const b = el("button", "", titulo); b.type = "button";
  if (sub) b.append(el("small", "", sub));
  b.onclick = fn; return b;
}
function reproducir(items, index, titulo) {
  const v = items.map((x) => ({ id: x.id || x.videoId, titulo: x.titulo || x.title || "", canal: x.canal || x.channel || "" }));
  window.jarvisMusica?.reproducir(v, index, titulo);
  closeSheet();
}
async function abrirMusica() {
  await cargarConnect();
  if (!yt.disponible) { musMsg("YouTube no está disponible en el servidor."); return; }
  if (!yt.permiso) { musMsg("Reconecte Google para dar permiso de YouTube (en Más)."); return; }
  musMsg("");
  const box = $("muslistas"); box.replaceChildren();
  try {
    const ls = primeraLista(await runTool("youtube.mis_playlists"));
    if (!ls.length) box.append(el("div", "empty", "Sin playlists."));
    for (const p of ls) {
      const nombre = p.titulo || p.title || p.nombre || "Playlist";
      box.append(filaMusica(nombre, p.total != null ? p.total + " vídeos" : "", async () => {
        musMsg("Cargando…");
        try { const r = primeraLista(await runTool("youtube.playlist", { id: p.id })); if (!r.length) return musMsg("Playlist vacía."); reproducir(r, 0, nombre); }
        catch (e) { musMsg("No se pudo: " + (e.data?.error || e.message)); }
      }));
    }
  } catch { box.append(el("div", "empty", "No pude cargar las playlists.")); }
}
$("musform").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("musin").value.trim(); if (!q) return;
  const box = $("musres"); box.replaceChildren(); musMsg("Buscando…");
  try {
    const r = primeraLista(await runTool("youtube.buscar", { q, max: 10 }));
    musMsg(r.length ? "" : "Sin resultados.");
    r.forEach((x, i) => box.append(filaMusica(x.titulo || x.title || "", x.canal || x.channel || "", () => reproducir(r, i, "Búsqueda: " + q))));
    cargarConnect();
  } catch (err) { musMsg("No se pudo buscar: " + (err.data?.error || err.message)); }
});
window.addEventListener("jarvis:musica-hoja", () => { if (current !== "musica") openSheet("musica"); });

async function renderGoogle() {
  const m = $("mgmsg"); m.hidden = true;
  const c = await cargarConnect();
  if (c.disponible && !c.permiso) { m.textContent = "Reconecte Google para dar permiso de YouTube"; m.hidden = false; }
}
// location.href directo: iOS bloquea window.open después de un await.
$("mgoogle").addEventListener("click", async () => {
  const m = $("mgmsg");
  try { const { url } = await googleStart(); if (url) location.href = url; }
  catch (e) { m.textContent = "No se pudo conectar: " + (e.data?.error || e.message); m.hidden = false; }
});
