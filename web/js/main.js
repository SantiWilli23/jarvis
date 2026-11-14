// Punto de entrada: pantalla de contraseña, WebSocket, orbe, voz y paneles.
import { getSettings, putSettings, api, login, getToken, setToken, onAuthLost, getStatus, sendChat, transcribe, decideApproval, pendingApprovals, deleteTask, approveReview, logout, waitForServer } from "./api.js";
import { connectWs, closeWs } from "./ws.js";
import { store, setState, subscribe, LABELS, VISUAL } from "./state.js";
import { initOrb, setVisual } from "./orb.js";
import { canRecord, startRecording, speak, stopSpeaking } from "./voice.js";
import { tickClock, renderMemory, renderQueue, renderConn, renderPc, showApproval } from "./panels.js";

const $ = (id) => document.getElementById(id);
const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
let typeTimer = null, recorder = null, busy = false, activeProvider = null, lastUsed = null, started = false;

/* ---------- texto del recuadro "say" ---------- */
function say(who, text) {
  $("who").textContent = who;
  clearInterval(typeTimer);
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
    case "task.update": case "providers.update": refreshStatus(); break;
    case "pc.status": renderPc(m); break;
    case "ws.closed": if (m.code === 4401 && getToken()) { setToken(""); showLogin(); } break;
  }
}

/* ---------- motor (Auto / Flash / Claude) ---------- */
const MOTORES = ["auto", "flash", "claude"];
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
  say("Usted", text);
  setState("thinking");
  try {
    const r = await sendChat(text, priv, store.convId, motorEfectivo());
    store.convId = r.conversationId || store.convId;
    activeProvider = r.provider || null;
    if (r.status === "ok" && r.provider) lastUsed = r.provider;
    $("memread").textContent = r.notes_read ?? 0;
    if (r.status === "sin_cuota") {
      setState("sin_cuota"); say("Jarvis", r.reply);
      speak(r.reply, () => setTimeout(() => { if (store.state === "sin_cuota") setState("idle"); }, 4000), r.private);
    } else {
      setState("speaking"); say("Jarvis", r.reply);
      speak(r.reply, afterSpeech, r.private);
    }
  } catch (e) {
    setState("sin_cuota");
    say("Jarvis", e.status === 401 ? "Su sesión terminó, señor." : "No pude comunicarme con el servidor, señor.");
    setTimeout(() => { if (store.state === "sin_cuota") setState("idle"); }, 4000);
  } finally { busy = false; activeProvider = null; refreshStatus(); }
}

/* ---------- toque en el orbe ---------- */
async function onOrb() {
  if (busy) return;
  if (!store.greeted) {                       // primer toque: saludo (también desbloquea la voz en iOS)
    store.greeted = true;
    say("Jarvis", "Hola señor.");
    setState("speaking");
    speak("Hola señor.", afterSpeech);
    $("hint").textContent = "Toque el orbe para hablar y otra vez para enviar.";
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
const NOTAS_MODO = { ia: "IA: con búsqueda web, herramientas y tareas para el PC.", chat: "Chat: solo conversar. Sin búsqueda web, acciones ni tareas." };
function pintarModo(m) {
  const modo = m === "chat" ? "chat" : "ia";
  for (const b of document.querySelectorAll("#panel-config [data-modo]")) b.setAttribute("aria-pressed", String(b.dataset.modo === modo));
  const nota = document.getElementById("cfg-nota"), tag = document.getElementById("modotag"); // solo existen en index.html (m.html no los trae)
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
  say("Jarvis", "A su servicio, señor. Toque el orbe.");
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
  setToken(""); started = false; showLogin();
});
$("sayform").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = $("sayin").value; $("sayin").value = "";
  store.greeted = true;
  converse(t, $("saypriv").checked);
});
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
if (getToken()) {
  try { await api("/auth/me"); await enter(); } catch { showLogin(); }
} else showLogin();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
