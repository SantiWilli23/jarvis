// "Conversar": charla en vivo con Gemini Live (docs/CONVERSA.md). Solo escritorio (/ y la app).
// El servidor da un token efímero y el audio va directo a Google. Todo texto se pinta con textContent.
import { api, getToken } from "./api.js";
import { store, setState } from "./state.js";
import { stopSpeaking, desbloquearVoz, ocupado, ponerCharla } from "./voice.js";

const WS = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
const AVISO = "Charla en vivo: Google puede usar lo que se diga aquí. No diga nada privado.";
const $ = (id) => document.getElementById(id);
let charla = null; // la charla en curso

const base64 = (bytes) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };

function pintar(quien, texto) {
  window.dispatchEvent(new CustomEvent("jarvis:conversa")); // main.js detiene su tecleo
  $("tu").hidden = true;
  $("who").textContent = quien;
  $("txt").textContent = texto;
}
function estado(s) {
  if (store.state === "permiso") return; // un pedido de permiso manda
  if (store.state !== s) setState(s);
  $("smodel").textContent = "charla en vivo";
}
const aviso = (texto) => { $("conversa-aviso").textContent = texto; $("conversa-aviso").hidden = !texto; };
function boton(si) {
  $("conversar").textContent = si ? "Colgar" : "Conversar";
  $("conversar").setAttribute("aria-pressed", String(si));
}

/* ---------- audio ---------- */
function callar(c) {
  for (const f of c.fuentes) { f.onended = null; try { f.stop(); } catch { /* ya terminó */ } }
  c.fuentes.clear();
  c.siguiente = 0;
}
function sonar(c, b64) { // PCM 16 bits mono a 24 kHz, encolado sin huecos
  const bin = atob(b64), n = bin.length >> 1;
  if (!n) return;
  const buf = c.ac.createBuffer(1, n, 24000), datos = buf.getChannelData(0);
  for (let i = 0; i < n; i++) { const v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); datos[i] = (v > 32767 ? v - 65536 : v) / 32768; }
  const f = c.ac.createBufferSource();
  f.buffer = buf; f.connect(c.ac.destination);
  c.siguiente = Math.max(c.siguiente, c.ac.currentTime + 0.05);
  f.start(c.siguiente); c.siguiente += buf.duration;
  c.fuentes.add(f);
  f.onended = () => { c.fuentes.delete(f); if (charla === c && !c.fuentes.size) estado("listening"); };
  estado("speaking");
}
async function abrirMic(c) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  if (charla !== c) return void stream.getTracks().forEach((t) => t.stop());
  c.stream = stream;
  await c.ac.audioWorklet.addModule("/js/wake/worklet.js");
  if (charla !== c) return;
  c.nodo = new AudioWorkletNode(c.ac, "escucha-16k", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  c.nodo.port.onmessage = ({ data }) => {
    if (charla !== c || !c.lista || c.ws?.readyState !== WebSocket.OPEN) return;
    const pcm = Int16Array.from(data, (x) => Math.max(-32768, Math.min(32767, x)));
    c.ws.send(JSON.stringify({ realtimeInput: { audio: { data: base64(new Uint8Array(pcm.buffer)), mimeType: "audio/pcm;rate=16000" } } }));
  };
  c.ac.createMediaStreamSource(stream).connect(c.nodo);
  c.nodo.connect(c.ac.destination); // salida muda: mantiene vivo el worklet
}

/* ---------- conexión ---------- */
function cerrarWs(c) {
  const ws = c.ws; c.ws = null; c.lista = false;
  if (ws) { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; try { ws.close(1000); } catch { /* ya cerrado */ } }
  clearTimeout(c.espera);
}
function conectar(c) {
  cerrarWs(c);
  const ws = new WebSocket(`${WS}?access_token=${encodeURIComponent(c.token)}`);
  c.ws = ws;
  ws.binaryType = "arraybuffer";
  const caida = (motivo) => {
    if (charla !== c || c.ws !== ws) return;
    // Con asa de reanudación se reintenta (pocas veces); sin ella, o sin cuota, se acaba.
    if (c.asa && c.intentos < 2 && !/quota/i.test(motivo)) { c.intentos++; return conectar(c); }
    terminar(/quota/i.test(motivo) ? "Google dice que se acabó la cuota de charla, señor." : "Se cortó la charla, señor.");
  };
  c.espera = setTimeout(() => caida(""), 12000);
  ws.onopen = () => ws.send(JSON.stringify({ setup: { model: c.modelo, sessionResumption: c.asa ? { handle: c.asa } : {} } }));
  ws.onclose = (e) => caida(e.reason || "");
  ws.onmessage = (e) => {
    if (charla !== c || c.ws !== ws) return;
    let m;
    try { m = JSON.parse(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data)); } catch { return; }
    recibir(c, m);
  };
}
function cerrarTurno(c) {
  for (const [role, k] of [["user", "dicho"], ["assistant", "respuesta"]]) {
    if (c[k].trim()) c.turnos.push({ role, texto: c[k].trim() });
    c[k] = "";
  }
}
function recibir(c, m) {
  if (m.setupComplete) { clearTimeout(c.espera); c.lista = true; c.intentos = 0; estado("listening"); return; }
  const r = m.sessionResumptionUpdate;
  if (r?.resumable && r.newHandle) c.asa = r.newHandle;
  if (m.goAway && c.asa) return conectar(c); // Google va a cerrar: se reanuda con el mismo token
  const s = m.serverContent;
  if (!s) return;
  if (s.interrupted) { callar(c); cerrarTurno(c); estado("listening"); }
  if (s.inputTranscription?.text) {
    if (c.respuesta) cerrarTurno(c);
    c.dicho += s.inputTranscription.text;
    if (c.privado.test(c.dicho)) return terminar("Corté la charla: eso suena privado. Pídamelo en el modo normal marcando «privado».", { privado: true });
    pintar("Usted", c.dicho);
  }
  for (const p of s.modelTurn?.parts ?? []) if (p.inlineData?.data) sonar(c, p.inlineData.data);
  if (s.outputTranscription?.text) { c.respuesta += s.outputTranscription.text; pintar("Jarvis", c.respuesta); }
  if (s.turnComplete) cerrarTurno(c);
}

/* ---------- empezar y terminar ---------- */
const avisarFin = (id, turnos) => api("/conversa/fin", { method: "POST", body: { id, turnos } }).catch(() => { /* el servidor ya lo tiene contado */ });

async function empezar() {
  if (charla) return;
  if ($("saypriv").checked) return pintar("Jarvis", "Con «privado» marcado no abro la charla en vivo, señor.");
  if (ocupado() && store.state !== "speaking") return; // está grabando
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) return pintar("Jarvis", "Este navegador no permite la charla en vivo, señor.");
  desbloquearVoz();
  stopSpeaking();
  store.greeted = true;
  const c = charla = { turnos: [], dicho: "", respuesta: "", fuentes: new Set(), siguiente: 0, intentos: 0, asa: null, lista: false };
  ponerCharla(true); // pausa "Hey Jarvis"
  boton(true); aviso(AVISO);
  c.saludo = new Audio("/audio/phrases/hola-senor.wav"); // al instante, mientras se prepara la conexión
  c.saludo.play().catch(() => {});
  pintar("Jarvis", "Hola señor.");
  estado("thinking");
  try {
    c.ac = new AudioContext();
    c.ac.resume().catch(() => {});
    const preparar = api("/conversa/token", { method: "POST", body: {} }).then((t) => {
      if (charla !== c) return void avisarFin(t.id, []); // colgó antes de que llegara
      c.id = t.id; c.token = t.token; c.modelo = t.modelo;
      c.privado = new RegExp(t.privado.source, t.privado.flags);
      c.tope = setTimeout(() => terminar("Llegamos al tope de esta charla, señor."), t.segundos * 1000);
      conectar(c);
    });
    await Promise.all([preparar, abrirMic(c)]);
  } catch (e) {
    if (charla !== c) return;
    terminar(e?.name === "NotAllowedError" ? "No tengo permiso para el micrófono, señor." : e?.data?.mensaje || "No pude abrir la charla, señor.");
  }
}

function terminar(mensaje = "", { privado = false } = {}) {
  const c = charla;
  if (!c) return;
  charla = null;
  cerrarTurno(c);
  clearTimeout(c.tope);
  cerrarWs(c);
  callar(c);
  c.saludo?.pause();
  if (c.nodo) { c.nodo.port.onmessage = null; c.nodo.disconnect(); }
  c.stream?.getTracks().forEach((t) => t.stop()); // suelta el micrófono
  c.ac?.close().catch(() => {});
  ponerCharla(false);
  boton(false);
  aviso("");
  if (store.state === "listening" || store.state === "speaking" || store.state === "thinking") setState("idle");
  if (mensaje) pintar("Jarvis", mensaje);
  if (c.id && getToken()) avisarFin(c.id, privado ? [] : c.turnos);
}

if (typeof document !== "undefined" && $("conversar")) {
  $("conversar").addEventListener("click", () => (charla ? terminar() : empezar()));
  window.addEventListener("jarvis:conversa-cortar", () => terminar());
  window.addEventListener("jarvis:freno", () => terminar("Freno puesto: corté la charla, señor."));
  window.addEventListener("pagehide", () => terminar());
}
