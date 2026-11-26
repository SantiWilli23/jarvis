// Punto de entrada: pantalla de contraseña, WebSocket, orbe, voz y paneles.
import { getSettings, putSettings, api, login, getToken, setToken, onAuthLost, getStatus, sendChat, transcribe, decideApproval, pendingApprovals, deleteTask, approveReview, logout, waitForServer, restaurarSesion } from "./api.js";
import { connectWs, closeWs } from "./ws.js";
import { store, setState, subscribe, LABELS, VISUAL } from "./state.js";
import { initOrb, setVisual } from "./orb.js";
import { canRecord, startRecording, speak, stopSpeaking, desbloquearVoz } from "./voice.js";
import "./musica.js";
import "./juegos.js";
import { pintarNav, limpiarFuentes, botonEnlace, botonPro } from "./nav.js";
import { tickClock, renderMemory, renderQueue, renderConn, renderPc, showApproval } from "./panels.js";

const $ = (id) => document.getElementById(id);
const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
let typeTimer = null, recorder = null, busy = false, activeProvider = null, lastUsed = null, started = false, pedido = "";

/* ---------- texto del recuadro "say" ---------- */
function say(who, text) {
  $("who").textContent = who;
  clearInterval(typeTimer);
  limpiarFuentes();
  $("msgacc").replaceChildren();
  $("tu").textContent = pedido; // lo último que pidió, encima de la respuesta
  $("tu").hidden = who === "Usted" || !pedido;
  const el = $("txt");
  if (reduce) { el.textContent = text; return; }
  let i = 0; el.textContent = "";
  typeTimer = setInterval(() => { i += 2; el.textContent = text.slice(0, i); if (i >= text.length) clearInterval(typeTimer); }, 22);
}

/* ---------- estado visual ---------- */
subscribe((what) => {
  if (what !== "state") return;
  const l = LABELS[store.state];
  setVisual(VISUAL[store.state]);
  const oyendo = store.state === "listening";
  $("saymic").setAttribute("aria-pressed", String(oyendo));
  $("saymic").setAttribute("aria-label", oyendo ? "Enviar audio" : "Hablar");
  $("slabel").textContent = l.label;
  $("smodel").textContent = store.state === "thinking" && activeProvider ? activeProvider : l.model;
  renderConn(store.status, lastUsed, store.state === "thinking");
});

async function refreshStatus() {
  try { store.status = await getStatus(); } catch { return; }
  renderMemory(store.status); renderQueue(store.status, onQueueAction); renderConn(store.status, lastUsed, store.state === "thinking"); renderPc(store.status.pc); try { aplicarMotor(); } catch { /* aún no existe */ }
}

async function onQueueAction(kind, id) {
  try { kind === "borrar" ? await deleteTask(id) : await approveReview(id); } catch (e) { say("Jarvis", "No pude hacerlo, señor: " + e.message); }
  refreshStatus();
}

/* ---------- aprobaciones ---------- */
function setApproval(a) {
  store.approval = a;
  showApproval(a);
  if (a) setState("permiso");
}
async function decide(approve) {
  const a = store.approval; if (!a) return;
  try { await decideApproval(a.id, approve); } catch { /* ya resuelta */ }
  setApproval(null);
  setState("idle");
  say("Jarvis", approve ? "Hecho, señor. Lo aprobé." : "Entendido, señor. Lo rechacé.");
  if (!document.body.classList.contains("movil")) siguienteAprobacion(); // en /m lo hace movil.js
}
async function siguienteAprobacion() {
  try { const { approvals } = await pendingApprovals(); if (approvals[0] && !store.approval) setApproval(approvals[0]); } catch { /* sin pendientes */ }
}

/* ---------- resultado de una acción del PC o del iPhone ---------- */
const resultadosVistos = new Set(); // "origen:id": no se repite si llega por WS y otra vez al reconectar
function mostrarResultado(m) {
  const k = String(m.origen) + ":" + String(m.id);
  if (resultadosVistos.has(k)) return;
  resultadosVistos.add(k);
  if (resultadosVistos.size > 200) resultadosVistos.delete(resultadosVistos.values().next().value);
  const txt = String(m.texto ?? "").slice(0, 400);
  if (!txt) return;
  say("Jarvis", txt); // say() usa textContent: nunca HTML del servidor
  if (m.hablar && !busy && store.state === "idle") { setState("speaking"); speak(txt, afterSpeech, !!m.privado); }
}

/* ---------- navegador de Claude: llega la respuesta ---------- */
function onNav(task) {
  if (!task.respuesta && !task.url_conversacion) return; // detenida sin nada que mostrar
  if (recorder || busy) return void setTimeout(() => onNav(task), 1500); // no pisar lo que el señor está haciendo
  stopSpeaking();
  say("Jarvis", ""); // detiene el tecleo y limpia las fuentes anteriores
  clearInterval(typeTimer);
  pintarNav(task);
  if (store.state === "permiso") return;
  setState("speaking");
  speak(String(task.respuesta || "").slice(0, 1500), afterSpeech, false); // lo privado nunca llega al navegador
}

/* ---------- mensajes del WebSocket ---------- */
function onWs(m) {
  window.dispatchEvent(new CustomEvent("jarvis:ws", { detail: m })); // la vista móvil (movil.js) también escucha
  switch (m.type) {
    case "state":
      // idle/listening/thinking/speaking los maneja este cliente; del servidor solo aceptamos los especiales
      if (m.state === "permiso" || m.state === "sin_cuota") setState(m.state);
      else if (m.state === "idle" && store.state === "permiso") { showApproval(null); setState("idle"); }
      break;
    case "approval.request": setApproval(m.approval); break;
    case "approval.resolved": if (store.approval?.id === m.approval.id) { setApproval(null); if (store.state === "permiso") setState("idle"); } break;
    case "conn.using": if (m.id) { lastUsed = m.id; renderConn(store.status, lastUsed, true); } break;
    case "chat.done": if (m.provider) lastUsed = m.provider; renderConn(store.status, lastUsed, false); break;
    case "nav.done": if (m.task) onNav(m.task); break;
    case "task.update": case "providers.update": refreshStatus(); break;
    case "pc.status": renderPc(m); break;
    case "accion.resultado": mostrarResultado(m); break;
    case "ws.closed": if (m.code === 4401 && getToken()) revisarSesionWs(); break;
  }
}

// El ws se cerró por 4401: no se borra el token sin confirmar (api() lo confirma con /auth/me y solo entonces muestra el login).
let wsRevisado = 0;
async function revisarSesionWs() {
  if (Date.now() - wsRevisado < 30000) return; // evita bucles si el servidor insiste
  wsRevisado = Date.now();
  try { await api("/auth/me"); if (getToken()) connectWs(onWs); } catch { /* 401 confirmado: onAuthLost ya mostró el login; red: se conserva el token */ }
}

/* ---------- motor (Auto / Nube / Gemini / Claude) ---------- */
const MOTORES = ["auto", "flash", "gemini", "claude"];
const motorGuardado = () => { try { const v = localStorage.getItem("jarvis_motor"); return MOTORES.includes(v) ? v : "auto"; } catch { return "auto"; } };
const motorEfectivo = () => $("saymotor")?.value || motorGuardado();
function aplicarMotor() {
  const sel = $("saymotor"); if (!sel) return;
  sel.value = motorGuardado();
}
if ($("saymotor")) {
  aplicarMotor();
  $("saymotor").addEventListener("change", () => { try { localStorage.setItem("jarvis_motor", $("saymotor").value); } catch { /* modo privado */ } });
}

/* ---------- conversación ---------- */
function afterSpeech() {
  if (store.state === "speaking") setState("idle");
}
async function converse(text, priv) {
  if (!text.trim() || busy) return;
  busy = true;
  pedido = text;
  say("Usted", text);
  setState("thinking");
  try {
    const r = await sendChat(text, priv, store.convId, motorEfectivo());
    store.convId = r.conversationId || store.convId;
    activeProvider = r.provider || null;
    if (r.status === "ok" && r.provider) lastUsed = r.provider;
    $("memread").textContent = r.notes_read ?? 0;
    window.dispatchEvent(new CustomEvent("jarvis:respuesta", { detail: r }));
    if (r.status === "musica") {                 // orden musical: solo texto, sin voz
      say("Jarvis", r.reply || "");
      window.dispatchEvent(new CustomEvent("jarvis:musica", { detail: r.musica }));
      setState("idle");
    } else if (r.status === "juego") {            // atajo a un juego: sin IA, el cliente abre la pestaña
      say("Jarvis", r.reply || "");
      window.dispatchEvent(new CustomEvent("jarvis:juego", { detail: { juegos: r.juegos || [], acciones: r.acciones || [] } }));
      setState("idle");
    } else if (r.status === "sin_cuota") {
      setState("sin_cuota"); say("Jarvis", r.reply);
      speak(r.reply, () => setTimeout(() => { if (store.state === "sin_cuota") setState("idle"); }, 4000), r.private);
    } else {
      setState("speaking"); say("Jarvis", r.reply);
      speak(r.reply, afterSpeech, r.private);
    }
    accionesDeMensaje(r);
  } catch (e) {
    setState("sin_cuota");
    say("Jarvis", e.status === 401 ? "Su sesión terminó, señor." : "No pude comunicarme con el servidor, señor.");
    setTimeout(() => { if (store.state === "sin_cuota") setState("idle"); }, 4000);
  } finally { busy = false; activeProvider = null; refreshStatus(); }
}

// Botones bajo la respuesta: abrir el hilo Pro o el juego (respaldo si el navegador bloqueó la pestaña).
function accionesDeMensaje(r) {
  const juegos = r.status === "juego" ? [...(r.juegos || []), ...(r.acciones || [])].map((j) => botonEnlace(j.url, "Abrir " + (j.nombre || "juego"))) : [];
  const unicos = new Map([botonPro(r.pro?.thread_id), ...juegos].filter(Boolean).map((a) => [a.href, a]));
  $("msgacc").replaceChildren(...unicos.values());
}

/* ---------- toque en el orbe ---------- */
async function onOrb() {
  if (busy) return;
  if (!store.greeted) {                       // primer toque: saludo (también desbloquea la voz en iOS)
    store.greeted = true;
    say("Jarvis", "Hola señor.");
    setState("speaking");
    speak("Hola señor.", afterSpeech);
    $("hint").textContent = "Toque para hablar y otra vez para enviar.";
    return;
  }
  if (store.state === "speaking") { stopSpeaking(); setState("idle"); return; }
  if (recorder) return stopAndSend();
  if (!canRecord()) { say("Jarvis", "Este navegador no puede grabar, señor. Escríbame abajo."); return; }
  try {
    recorder = await startRecording(() => stopAndSend());
    setState("listening");
    say("Usted", "…le escucho.");
  } catch {
    recorder = null;
    say("Jarvis", "No tengo permiso para el micrófono, señor. Revise los ajustes de Safari.");
  }
}
async function stopAndSend() {
  const r = recorder; recorder = null;
  if (!r) return;
  setState("thinking"); $("smodel").textContent = "transcribiendo";
  try {
    const blob = await r.stop();
    if (blob.size < 800) { setState("idle"); say("Jarvis", "No le oí nada, señor."); return; }
    const { text } = await transcribe(blob);
    if (!text?.trim()) { setState("idle"); say("Jarvis", "No le entendí, señor. ¿Puede repetirlo?"); return; }
    await converse(text, false);
  } catch {
    setState("idle"); say("Jarvis", "Falló la transcripción, señor.");
  }
}

/* ---------- pantalla de contraseña ---------- */
function showLogin() {
  closeWs();
  $("login").hidden = false; $("app").style.visibility = "hidden";
  $("pw").value = ""; setTimeout(() => $("pw").focus(), 50);
}
/* ---------- configuración: modo IA / Chat (se guarda en el servidor) ---------- */
const NOTAS_MODO = { ia: "Busca en la web y hace tareas.", chat: "Solo conversar." };
function pintarModo(m) {
  const modo = m === "chat" ? "chat" : "ia";
  for (const b of document.querySelectorAll("#panel-config [data-modo]")) b.setAttribute("aria-pressed", String(b.dataset.modo === modo));
  const nota = document.getElementById("cfg-nota"), tag = document.getElementById("modotag");
  if (nota) nota.textContent = NOTAS_MODO[modo];
  if (tag) tag.hidden = modo !== "chat";
  document.body.dataset.modo = modo;
}
async function cargarModo() { try { pintarModo((await getSettings()).modo); } catch { /* sin conexión: queda el último */ } }
for (const b of document.querySelectorAll("#panel-config [data-modo]")) {
  b.addEventListener("click", async () => {
    const antes = document.body.dataset.modo || "ia";
    pintarModo(b.dataset.modo);
    try { pintarModo((await putSettings(b.dataset.modo)).modo); } catch { pintarModo(antes); const n = document.getElementById("cfg-nota"); if (n) n.textContent = "No se pudo guardar el modo. Reintente."; }
  });
}

async function enter() {
  $("login").hidden = true; $("app").style.visibility = "visible";
  if (started) return; started = true;
  await refreshStatus();
  cargarModo();
  try { const { approvals } = await pendingApprovals(); if (approvals[0]) setApproval(approvals[0]); } catch { /* sin pendientes */ }
  connectWs(onWs);
  say("Jarvis", "A su servicio, señor.");
}

$("loginform").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("loginerr").textContent = "";
  try {
    const { token } = await login($("pw").value);
    setToken(token); await enter();
  } catch (err) {
    $("loginerr").textContent = err.status === 429 ? `Demasiados intentos. Espere ${Math.ceil((err.data?.retry_after_s || 900) / 60)} min.` : "Contraseña incorrecta.";
  }
});
$("logout").addEventListener("click", async () => {
  try { await logout(); } catch { /* ya caducó */ }
  setToken(""); started = false; pedido = ""; showLogin();
});
$("sayform").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = $("sayin").value; $("sayin").value = "";
  store.greeted = true;
  converse(t, $("saypriv").checked);
});
// Botón de micrófono: graba directo (sin el saludo del primer toque del orbe).
$("saymic").addEventListener("click", () => { store.greeted = true; desbloquearVoz(); onOrb(); });
$("yes").addEventListener("click", () => decide(true));
$("no").addEventListener("click", () => decide(false));
onAuthLost(() => { started = false; showLogin(); });

/* ---------- arranque ---------- */
tickClock(); setInterval(tickClock, 15000);
initOrb($("orb"));
$("orb").addEventListener("click", onOrb);
// La app de escritorio (atajo global) pide activar el micrófono.
window.addEventListener("jarvis:mic", () => { store.greeted = true; if (!recorder && store.state !== "thinking") onOrb(); });
setState("idle");

await waitForServer(() => { $("wake").hidden = false; }, () => { $("wake").hidden = true; });
if (!getToken()) await restaurarSesion(); // el navegador perdió localStorage pero la cookie sigue viva
if (getToken()) {
  let hecho = false;
  for (let i = 0; i < 4 && !hecho; i++) {
    try { await api("/auth/me"); await enter(); hecho = true; }
    catch (e) { if (e.status === 401) { hecho = true; showLogin(); } else await new Promise((r) => setTimeout(r, 1500)); } // red/5xx: se conserva el token
  }
  if (!hecho) showLogin(); // sin respuesta tras varios intentos: login, pero el token sigue guardado
} else showLogin();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
