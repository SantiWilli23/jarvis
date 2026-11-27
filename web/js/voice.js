// Voz: grabación con MediaRecorder (Safari/iPhone) y salida de voz por la cadena del servidor (/api/tts) con respaldo en la voz del navegador.
// No usa Web Speech API de reconocimiento: la transcripción la hace el servidor (Groq Whisper).

import { getToken } from "./api.js";

const MAX_MS = 30000;

function pickMime() {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"]) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* siguiente */ }
  }
  return "";
}

export const canRecord = () => !!(navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined");

// Para la escucha de "Hey Jarvis" (app de escritorio): se pausa mientras se graba o se habla.
let grabando = 0, hablando = false;
export const ocupado = () => grabando > 0 || hablando;

// Empieza a grabar. Devuelve { stop(): Promise<Blob> }.
export async function startRecording(onAutoStop) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = pickMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise((res) => {
    rec.onstop = () => {
      grabando--;
      stream.getTracks().forEach((t) => t.stop());
      res(new Blob(chunks, { type: rec.mimeType || mime || "audio/mp4" }));
    };
  });
  rec.start();
  grabando++;
  const timer = setTimeout(() => { if (rec.state !== "inactive") { rec.stop(); onAutoStop?.(); } }, MAX_MS);
  return { stop() { clearTimeout(timer); if (rec.state !== "inactive") rec.stop(); return done; } };
}

let voice = null;
function pickVoice() {
  const vs = (window.speechSynthesis?.getVoices() || []).filter((v) => /^es/i.test(v.lang));
  const male = /jorge|diego|pablo|alvaro|enrique|raul|carlos|juan|miguel|andres|male|masculin/i;
  return vs.find((v) => male.test(v.name)) || vs[0] || null;
}
if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.onvoiceschanged = () => { voice = pickVoice(); };

// Voz del navegador (último recurso): tono bajo y calmado.
function speakBrowser(msg, end) {
  try {
    if (!window.speechSynthesis) return end();
    const u = new SpeechSynthesisUtterance(msg);
    voice = voice || pickVoice();
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = "es-ES";
    u.rate = 0.88; u.pitch = 0.7;
    // Seguro por si Safari nunca dispara onend
    const seguro = setTimeout(end, Math.max(4000, msg.length * 120));
    u.onend = u.onerror = () => { clearTimeout(seguro); end(); };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch { end(); }
}

// Un solo <audio> reutilizado: se "desbloquea" en el primer toque (iOS) y luego sirve para todo el audio del servidor.
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
let player = null, token = 0;
function getPlayer() {
  if (!player) { player = new Audio(); player.src = SILENCE; player.play().catch(() => {}); }
  return player;
}

// Para llamar dentro de un toque: deja el audio listo en iOS sin decir nada.
export function desbloquearVoz() { try { getPlayer(); } catch { /* sin audio */ } }

// Reproduce un audio; resuelve true si sonó entero y false si no se pudo.
function reproducir(a, blob, soltables) {
  return new Promise((res) => {
    const url = URL.createObjectURL(blob);
    soltables.add(url);
    let hecho = false;
    const fin = (ok) => { if (hecho) return; hecho = true; soltables.delete(url); URL.revokeObjectURL(url); res(ok); };
    a.onended = () => fin(true);
    a.onerror = () => fin(false);
    a.src = url;
    Promise.resolve(a.play()).catch(() => fin(false));
  });
}
const delNavegador = (texto) => new Promise((res) => { let hecho = false; speakBrowser(texto, () => { if (!hecho) { hecho = true; res(); } }); });

let cortar = null; // aborta las descargas y suelta el audio de lo que se esté diciendo

// Dice el texto. Si el chat ya trajo voz.partes, pide todas a la vez (GET /api/tts/:id) y las reproduce en orden;
// la parte que no dé audio se lee con la voz del navegador. Sin partes: POST /api/tts (204 o fallo = voz del navegador).
// llama a onEnd al terminar (o enseguida si no hay nada con qué hablar).
export function speak(msg, onEnd, priv = false, voz = null) {
  cortar?.();
  let ended = false;
  const end = () => { if (!ended) { ended = true; if (me === token) hablando = false; onEnd?.(); } };
  const me = ++token;
  hablando = true;
  const a = getPlayer();           // se crea dentro del gesto del usuario
  a.onended = a.onerror = null;
  const ctl = new AbortController(), soltables = new Set();
  cortar = () => { ctl.abort(); a.onended = a.onerror = null; for (const u of soltables) URL.revokeObjectURL(u); soltables.clear(); };
  const auth = { authorization: `Bearer ${getToken()}` };
  const audioDe = async (url, opciones) => {
    try {
      const res = await fetch(url, { ...opciones, signal: ctl.signal });
      return res.status === 200 ? await res.blob() : null;
    } catch { return null; }
  };
  const partes = !priv && Array.isArray(voz?.partes) ? voz.partes.filter((p) => p?.id != null && p.texto) : [];
  const trozos = partes.length
    ? partes.map((p) => ({ texto: p.texto, audio: audioDe(`/api/tts/${encodeURIComponent(p.id)}`, { headers: auth }) }))
    : [{ texto: msg, audio: audioDe("/api/tts", { method: "POST", headers: { "content-type": "application/json", ...auth }, body: JSON.stringify({ text: msg, private: !!priv }) }) }];
  (async () => {
    for (const trozo of trozos) {
      const blob = await trozo.audio;
      if (me !== token) return;    // otro habla o lo cortaron
      const sono = blob ? await reproducir(a, blob, soltables) : false;
      if (me !== token) return;
      if (!sono) await delNavegador(trozo.texto);
      if (me !== token) return;
    }
    end();
  })();
}
export function stopSpeaking() {
  token++;
  hablando = false;
  cortar?.(); cortar = null;
  try { player?.pause(); } catch { /* nada */ }
  try { window.speechSynthesis?.cancel(); } catch { /* nada */ }
}
