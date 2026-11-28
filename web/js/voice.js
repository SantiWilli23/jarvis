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
let grabando = 0, hablando = false, charla = false;
// Charla en vivo (conversa.js): mientras dura, la escucha se pausa y no se lee nada más en voz alta.
export const enCharla = () => charla;
export const ponerCharla = (si) => { charla = !!si; };
export const ocupado = () => grabando > 0 || hablando || charla;

// Decide cuándo cortar una grabación. paso(nivel RMS en escala int16) devuelve null, "silencio" o "sin_voz".
// El ruido de fondo es el mínimo de los últimos 5 s, así el umbral se adapta a la sala.
export function createCorte({ silencioMs, sinVozMs = 8000, now = Date.now }) {
  let ventana = [], inicio = null, ultimaVoz = null, callados = 0;
  return {
    paso(nivel) {
      const t = now();
      if (inicio === null) { if (nivel < 1) return null; inicio = t; } // micrófono aún sin señal
      ventana.push({ t, nivel });
      while (t - ventana[0].t > 5000) ventana.shift();
      const piso = ventana.reduce((m, x) => (x.nivel >= 1 && x.nivel < m ? x.nivel : m), 2000);
      const umbral = Math.max(250, piso * 3);
      // se mira toda la ventana: quien habla desde el primer instante se reconoce al llegar la primera pausa
      const altos = ventana.filter((x) => x.nivel > umbral);
      if (altos.length >= 2 || (ultimaVoz !== null && altos.length)) ultimaVoz = Math.max(ultimaVoz ?? 0, altos.at(-1).t);
      callados = nivel > umbral ? 0 : callados + 1;
      if (ultimaVoz === null) return t - inicio >= sinVozMs ? "sin_voz" : null;
      return t - ultimaVoz >= silencioMs && callados >= 4 ? "silencio" : null; // 4: aguanta el temporizador lento de una ventana oculta
    },
  };
}

// Mide el micrófono mientras se graba. Si no se puede medir, queda el toque y el máximo de 30 s.
function vigilarSilencio(stream, opciones, alCortar) {
  try {
    const ac = new AudioContext();
    ac.resume?.()?.catch(() => {});
    const analizador = ac.createAnalyser();
    analizador.fftSize = 2048;
    ac.createMediaStreamSource(stream).connect(analizador);
    const muestras = new Float32Array(analizador.fftSize), corte = createCorte(opciones);
    const reloj = setInterval(() => {
      if (ac.state !== "running") return;
      analizador.getFloatTimeDomainData(muestras);
      let suma = 0;
      for (const x of muestras) suma += x * x;
      const motivo = corte.paso(Math.sqrt(suma / muestras.length) * 32767);
      if (motivo) alCortar(motivo);
    }, 80);
    return () => { clearInterval(reloj); ac.close().catch(() => {}); };
  } catch { return () => {}; }
}

// Empieza a grabar. Devuelve { stop(): Promise<Blob> }.
// Con silencioMs corta sola: onAutoStop("silencio") tras oír voz y callar, u onAutoStop("sin_voz") si no se oye nada.
export async function startRecording(onAutoStop, { silencioMs, sinVozMs } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = pickMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  let soltarVigia = () => {};
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise((res) => {
    rec.onstop = () => {
      grabando--;
      soltarVigia();
      stream.getTracks().forEach((t) => t.stop());
      res(new Blob(chunks, { type: rec.mimeType || mime || "audio/mp4" }));
    };
  });
  rec.start();
  grabando++;
  const auto = (motivo) => { if (rec.state !== "inactive") { clearTimeout(timer); rec.stop(); onAutoStop?.(motivo); } };
  const timer = setTimeout(() => auto(), MAX_MS);
  if (silencioMs) soltarVigia = vigilarSilencio(stream, { silencioMs, sinVozMs }, auto);
  return { stop() { clearTimeout(timer); if (rec.state !== "inactive") rec.stop(); return done; } };
}

// soloLocal (texto privado o escolar): solo voces que hablan en el equipo, nunca las de la nube (p. ej. Edge).
function pickVoice(soloLocal) {
  const vs = (window.speechSynthesis?.getVoices() || []).filter((v) => /^es/i.test(v.lang) && (!soloLocal || v.localService === true));
  const male = /jorge|diego|pablo|alvaro|enrique|raul|carlos|juan|miguel|andres|male|masculin/i;
  return vs.find((v) => male.test(v.name)) || vs[0] || null;
}
try { window.speechSynthesis?.getVoices(); } catch { /* sin voz o sin window */ } // pide la lista pronto

// Voz del navegador (último recurso): tono bajo y calmado. Lo privado, sin voz local, no se lee.
function speakBrowser(msg, end, priv) {
  try {
    if (!window.speechSynthesis) return end();
    const u = new SpeechSynthesisUtterance(msg);
    const voice = pickVoice(priv);
    if (priv && !voice) return end();
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
let vozLista = false;
export function desbloquearVoz() {
  try { getPlayer(); } catch { /* sin audio */ }
  // iOS solo deja hablar al navegador si la primera vez fue dentro de un toque.
  try { if (!vozLista) { window.speechSynthesis.speak(new SpeechSynthesisUtterance("")); vozLista = true; } } catch { /* sin voz */ }
}

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
const delNavegador = (texto, priv) => new Promise((res) => { let hecho = false; speakBrowser(texto, () => { if (!hecho) { hecho = true; res(); } }, priv); });

let cortar = null; // aborta las descargas y suelta el audio de lo que se esté diciendo

// Dice el texto. Si el chat ya trajo voz.partes, pide todas a la vez (GET /api/tts/:id) y las reproduce en orden;
// la parte que no dé audio se lee con la voz del navegador. Sin partes: POST /api/tts (204 o fallo = voz del navegador).
// llama a onEnd al terminar (o enseguida si no hay nada con qué hablar).
export function speak(msg, onEnd, priv = false, voz = null) {
  if (charla) return void onEnd?.();
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
  const trozos = !priv && voz?.navegador ? [{ texto: msg, audio: null }] : partes.length
    ? partes.map((p) => ({ texto: p.texto, audio: audioDe(`/api/tts/${encodeURIComponent(p.id)}`, { headers: auth }) }))
    : [{ texto: msg, audio: audioDe("/api/tts", { method: "POST", headers: { "content-type": "application/json", ...auth }, body: JSON.stringify({ text: msg, private: !!priv }) }) }];
  (async () => {
    for (const trozo of trozos) {
      const blob = await trozo.audio;
      if (me !== token) return;    // otro habla o lo cortaron
      const sono = blob ? await reproducir(a, blob, soltables) : false;
      if (me !== token) return;
      if (!sono) await delNavegador(trozo.texto, !!priv);
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
