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

// Empieza a grabar. Devuelve { stop(): Promise<Blob> }.
export async function startRecording(onAutoStop) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = pickMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise((res) => {
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      res(new Blob(chunks, { type: rec.mimeType || mime || "audio/mp4" }));
    };
  });
  rec.start();
  const timer = setTimeout(() => { if (rec.state !== "inactive") { rec.stop(); onAutoStop?.(); } }, MAX_MS);
  return { stop() { clearTimeout(timer); if (rec.state !== "inactive") rec.stop(); return done; } };
}

let voice = null;
function pickVoice() {
  const vs = (window.speechSynthesis?.getVoices() || []).filter((v) => /^es/i.test(v.lang));
  const male = /jorge|diego|pablo|alvaro|enrique|raul|carlos|juan|miguel|andres|male|masculin/i;
  return vs.find((v) => male.test(v.name)) || vs[0] || null;
}
if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = () => { voice = pickVoice(); };

// Voz del navegador (último recurso): tono bajo y calmado.
function speakBrowser(msg, end) {
  try {
    if (!window.speechSynthesis) return end();
    const u = new SpeechSynthesisUtterance(msg);
    voice = voice || pickVoice();
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = "es-ES";
    u.rate = 0.88; u.pitch = 0.7;
    u.onend = end; u.onerror = end;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    // Seguro por si Safari nunca dispara onend
    setTimeout(end, Math.max(4000, msg.length * 120));
  } catch { end(); }
}

// Un solo <audio> reutilizado: se "desbloquea" en el primer toque (iOS) y luego sirve para todo el audio del servidor.
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
let player = null, token = 0;
function getPlayer() {
  if (!player) { player = new Audio(); player.src = SILENCE; player.play().catch(() => {}); }
  return player;
}

// Dice el texto: pide /api/tts (pregrabada > Gemini > MiniMax); si responde 204 o falla, usa la voz del navegador.
// llama a onEnd al terminar (o enseguida si no hay nada con qué hablar).
export function speak(msg, onEnd, priv = false) {
  let ended = false;
  const end = () => { if (!ended) { ended = true; onEnd?.(); } };
  const me = ++token;
  const a = getPlayer();           // se crea dentro del gesto del usuario
  (async () => {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ text: msg, private: !!priv }),
      });
      if (me !== token) return;    // otro habla o lo cortaron
      if (res.status === 200) {
        const url = URL.createObjectURL(await res.blob());
        if (me !== token) { URL.revokeObjectURL(url); return; }
        a.onended = () => { URL.revokeObjectURL(url); end(); };
        a.onerror = () => { URL.revokeObjectURL(url); speakBrowser(msg, end); };
        a.src = url;
        await a.play();
        return;
      }
    } catch { /* cae a la voz del navegador */ }
    if (me === token) speakBrowser(msg, end);
  })();
}
export function stopSpeaking() {
  token++;
  try { player?.pause(); } catch { /* nada */ }
  try { window.speechSynthesis?.cancel(); } catch { /* nada */ }
}
