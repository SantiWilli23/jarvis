// Vista móvil: hojas inferiores, teclado, aprobaciones, pestaña Teléfono y utilidades del iPhone.
// Convive con main.js (que maneja orbe, voz y paneles). Todo texto del servidor se inserta con textContent.
import { api, getToken } from "./api.js";
import { store, setState } from "./state.js";
import { showApproval } from "./panels.js";

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const body = document.body;
const safe = (fn) => { try { return fn(); } catch { /* API no disponible */ } };
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

/* ---------- hojas inferiores (una sola abierta) ---------- */
const sheets = { cola: $("sh-cola"), tel: $("sh-tel"), estado: $("sh-estado"), mas: $("sh-mas") };
let current = null;

function closeSheet() {
  if (!current) return;
  const s = sheets[current]; current = null;
  s.classList.remove("on"); s.style.transform = "";
  $("scrim").classList.remove("on");
  document.querySelectorAll(".dock [data-open]").forEach((b) => b.classList.remove("on"));
  setTimeout(() => { if (!s.classList.contains("on")) s.hidden = true; if (!current) $("scrim").hidden = true; }, 260);
}
function openSheet(name) {
  closeKeyboard();
  if (current === name) return closeSheet();
  if (current) { const prev = sheets[current]; prev.classList.remove("on"); prev.hidden = true; }
  current = name;
  const s = sheets[name];
  s.hidden = false; s.style.transform = "";
  $("scrim").hidden = false;
  void s.offsetHeight; // reflujo para que corra la transición
  s.classList.add("on"); $("scrim").classList.add("on");
  document.querySelectorAll(".dock [data-open]").forEach((b) => b.classList.toggle("on", b.dataset.open === name));
  if (name === "tel") loadPhone();
  if (name === "cola") { loadPhone(); }
  if (name === "mas") renderMas();
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

document.querySelectorAll(".dock [data-open]").forEach((b) => b.addEventListener("click", () => {
  const k = b.dataset.open;
  if (k === "kb") { closeSheet(); toggleKeyboard(); } else openSheet(k);
}));

/* ---------- teclado: el campo de texto sube con el teclado (visualViewport) ---------- */
function closeKeyboard() {
  const f = $("sayform");
  if (!f.classList.contains("open")) return;
  f.classList.remove("open");
  safe(() => $("sayin").blur());
  body.classList.remove("kbopen"); root.style.setProperty("--kb", "0px");
}
function toggleKeyboard() {
  const f = $("sayform");
  if (f.classList.contains("open")) return closeKeyboard();
  f.classList.add("open");
  setTimeout(() => $("sayin").focus(), 60);
}
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
$("sayform").addEventListener("focusout", (e) => {
  if (e.relatedTarget && $("sayform").contains(e.relatedTarget)) return;
  setTimeout(() => { if (!$("sayform").contains(document.activeElement)) closeKeyboard(); }, 200);
});
$("orb").addEventListener("click", () => { closeKeyboard(); closeSheet(); }, true);

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
  else if (m.type === "phone.update") { if (current === "tel" || current === "cola") loadPhone(); else phoneCounts(); }
});
// Tras iniciar sesión (o al abrir con sesión guardada) se cargan los pendientes.
new MutationObserver(() => { if ($("login").hidden) refreshApprovals(); }).observe($("login"), { attributes: true, attributeFilter: ["hidden"] });
setTimeout(refreshApprovals, 1500);

/* ---------- Más: notificaciones, vista escritorio, dispositivos ---------- */
function renderMas() {
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
$("devnew").addEventListener("click", async () => {
  const t = $("devtoken");
  try {
    const out = await api("/devices", { method: "POST", body: { name: "iPhone (Atajo)", kind: "phone" } });
    t.textContent = out.token; t.hidden = false;
    $("devmsg").textContent = "cópielo ahora: no se vuelve a mostrar";
    loadDevices();
  } catch { t.textContent = "No pude crear el token."; t.hidden = false; }
});

/* ---------- Teléfono: cola de acciones para el iPhone ---------- */
const TILES = [
  ["Linterna", "encender", { accion: "linterna", valor: "on" }], ["Linterna", "apagar", { accion: "linterna", valor: "off" }], ["Batería", "", { accion: "bateria" }],
  ["No molestar", "1 hora", { accion: "no_molestar", valor: "on", minutos: 60 }], ["No molestar", "apagar", { accion: "no_molestar", valor: "off" }], ["Vibrar", "", { accion: "vibrar" }],
  ["Bluetooth", "encender", { accion: "bluetooth", valor: "on" }], ["Bluetooth", "apagar", { accion: "bluetooth", valor: "off" }], ["Bajo consumo", "encender", { accion: "bajo_consumo", valor: "on" }],
  ["Modo oscuro", "encender", { accion: "modo_oscuro", valor: "on" }], ["Modo oscuro", "apagar", { accion: "modo_oscuro", valor: "off" }], ["Pausa", "música", { accion: "multimedia", valor: "pausa" }],
  ["Play", "música", { accion: "multimedia", valor: "play" }], ["Siguiente", "canción", { accion: "multimedia", valor: "siguiente" }], ["Wi-Fi", "apagar", { accion: "wifi", valor: "off" }],
  ["Modo avión", "encender", { accion: "modo_avion", valor: "on" }], ["Portapapeles", "leer", { accion: "leer_portapapeles" }], ["WhatsApp", "abrir", { accion: "abrir_app", valor: "WhatsApp" }],
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
  } catch (e) { say("no se pudo: " + (e.data?.error || e.message)); }
  loadPhone();
}
function renderTiles() {
  const g = $("phgrid"); if (g.childElementCount) return;
  for (const [t, sub, spec] of TILES) {
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
