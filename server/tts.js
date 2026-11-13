// Cadena de voz del servidor. Orden: (a) frases pregrabadas, (b) Gemini TTS, (c) MiniMax,
// (d) nada -> el navegador usa speechSynthesis. Todo fallo cae en silencio a la siguiente voz.
// Privacidad: texto privado NUNCA sale a Gemini ni a MiniMax (solo pregrabadas locales o navegador).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { createHash } from "node:crypto";
import { get, run } from "./db/client.js";

const MIME = { ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4" };
const dayKey = (t) => "d:" + new Date(t).toISOString().slice(0, 10);

// "¡Hola,  Señor!" -> "hola señor" (sin mayúsculas, puntuación ni espacios repetidos)
export function normalizePhrase(t) {
  return String(t ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// PCM 16 bits mono -> WAV
export function pcmToWav(pcm, sampleRate = 24000, channels = 1) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * channels * 2, 28); h.writeUInt16LE(channels * 2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const ESTILO_GEMINI = "Di lo siguiente en español, con voz masculina grave, calmada y formal, con aire de mayordomo británico: ";
const DESC_VOZ_MINIMAX = "Voz masculina grave y calmada, tono formal y educado, aire de mayordomo británico, hablando en español, pausada y elegante.";

export function createTts({ db, env = {}, fetch: f = globalThis.fetch, config = {}, privacy, phrasesDir, cacheDir, now = () => Date.now() }) {
  const gcfg = { enabled: true, modelo: "gemini-2.5-flash-preview-tts", voz: "Algenib", tope_dia: 30, ...(config.gemini || {}) };
  const mcfg = { enabled: false, modelo: "speech-2.8-hd", tope_caracteres_dia: 5000, ...(config.minimax || {}) };
  const maxChars = config.max_caracteres ?? 400;
  const cacheables = new Set((config.cachear || ["Hola señor."]).map(normalizePhrase));
  const paused = {}; // voz -> ms hasta los que no se insiste

  const geminiOn = () => gcfg.enabled && !!env.GEMINI_API_KEY;
  const minimaxOn = () => mcfg.enabled === true && !!env.MINIMAX_API_KEY;
  // "gemini" y "minimax" no están en la lista blanca de privacidad: con texto privado dan false.
  const allowed = (id, isPrivate) => !privacy || privacy.isAllowed(id, isPrivate);

  async function used(userId, provider) {
    const r = await get(db, "SELECT count, tokens FROM provider_usage WHERE user_id=? AND provider=? AND window_key=?", [userId, provider, dayKey(now())]);
    return { count: r ? Number(r.count) : 0, chars: r ? Number(r.tokens) : 0 };
  }
  async function record(userId, provider, chars) {
    await run(db, `INSERT INTO provider_usage (user_id, provider, window_key, count, tokens, created_at) VALUES (?,?,?,1,?,?)
      ON CONFLICT(user_id, provider, window_key) DO UPDATE SET count = count + 1, tokens = tokens + excluded.tokens`,
      [userId, provider, dayKey(now()), chars, now()]);
  }

  function prerecorded(text) {
    try {
      const mf = join(phrasesDir, "manifest.json");
      if (!existsSync(mf)) return null;
      const want = normalizePhrase(text);
      const fr = (JSON.parse(readFileSync(mf, "utf8")).frases || []).find((x) => normalizePhrase(x.texto) === want);
      if (!fr?.archivo) return null;
      const file = join(phrasesDir, basename(fr.archivo));
      if (!existsSync(file)) return null;
      return { source: "pregrabada", mime: MIME[extname(file).toLowerCase()] || "audio/mpeg", data: readFileSync(file) };
    } catch { return null; }
  }

  const cacheFile = (text, source) => join(cacheDir, createHash("sha256").update(source + "|" + normalizePhrase(text)).digest("hex").slice(0, 24));
  function cacheRead(text, source) {
    try {
      for (const ext of [".wav", ".mp3"]) { const p = cacheFile(text, source) + ext; if (existsSync(p)) return { mime: MIME[ext], data: readFileSync(p) }; }
    } catch { /* sin caché */ }
    return null;
  }
  function cacheWrite(text, source, mime, data) {
    try { mkdirSync(cacheDir, { recursive: true }); writeFileSync(cacheFile(text, source) + (mime === "audio/wav" ? ".wav" : ".mp3"), data); } catch { /* sin caché */ }
  }

  async function gemini(userId, text) {
    const u = await used(userId, "tts_gemini");
    if (u.count >= gcfg.tope_dia) return null;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${gcfg.modelo}:generateContent`;
    const res = await f(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: ESTILO_GEMINI + text }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: gcfg.voz } } } },
      }),
    });
    if (res.status === 429) { paused.gemini = now() + 10 * 60_000; return null; }
    if (!res.ok) { paused.gemini = now() + 60_000; return null; }
    const b64 = (await res.json())?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
    if (!b64) return null;
    await record(userId, "tts_gemini", text.length);
    return { source: "gemini", mime: "audio/wav", data: pcmToWav(Buffer.from(b64, "base64"), 24000) }; // PCM 24 kHz 16 bits mono
  }

  async function minimaxVoice(userId) {
    const cur = await get(db, "SELECT value FROM settings WHERE user_id=? AND key='minimax_voice_id'", [userId]);
    if (cur?.value) return cur.value;
    const res = await f("https://api.minimax.io/v1/voice_design", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.MINIMAX_API_KEY}` },
      body: JSON.stringify({ prompt: DESC_VOZ_MINIMAX, preview_text: "Hola, señor. A sus órdenes." }),
    });
    const j = res.ok ? await res.json() : null;
    const id = j?.voice_id;
    if (!id || (j?.base_resp?.status_code ?? 0) !== 0) return null;
    await run(db, "INSERT INTO settings (user_id, key, value, created_at) VALUES (?,?,?,?) ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value", [userId, "minimax_voice_id", id, now()]);
    return id;
  }

  async function minimax(userId, text) {
    const u = await used(userId, "tts_minimax");
    if (u.chars + text.length > mcfg.tope_caracteres_dia) return null;
    const voice = await minimaxVoice(userId);
    if (!voice) return null;
    const res = await f("https://api.minimax.io/v1/t2a_v2", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.MINIMAX_API_KEY}` },
      body: JSON.stringify({ model: mcfg.modelo, text, stream: false, voice_setting: { voice_id: voice, speed: 0.95, vol: 1, pitch: 0 }, audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 }, output_format: "hex" }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    if ((j?.base_resp?.status_code ?? 0) !== 0 || !j?.data?.audio) { paused.minimax = now() + 10 * 60_000; return null; } // p. ej. 1008 sin saldo
    await record(userId, "tts_minimax", text.length);
    return { source: "minimax", mime: "audio/mpeg", data: Buffer.from(j.data.audio, "hex") };
  }

  const VOCES = [
    { id: "gemini", on: geminiOn, fn: gemini },
    { id: "minimax", on: minimaxOn, fn: minimax },
  ];

  return {
    // Devuelve { source, mime, data } o null (el navegador usa su propia voz).
    async synth({ userId, text, isPrivate = false }) {
      const t = String(text ?? "");
      if (!t.trim()) return null;
      const pre = prerecorded(t);
      if (pre) return pre;
      if (isPrivate || t.length > maxChars) return null;
      const greet = cacheables.has(normalizePhrase(t));
      for (const v of VOCES) {
        if (!v.on() || !allowed(v.id, isPrivate) || (paused[v.id] || 0) > now()) continue;
        if (greet) { const c = cacheRead(t, v.id); if (c) return { source: v.id + "-cache", ...c }; }
        try {
          const r = await v.fn(userId, t);
          if (r) { if (greet) cacheWrite(t, v.id, r.mime, r.data); return r; }
        } catch { /* cae a la siguiente voz */ }
      }
      return null;
    },
    async status(userId) {
      const g = await used(userId, "tts_gemini"), m = await used(userId, "tts_minimax");
      return {
        gemini: { activo: geminiOn(), usado: g.count, tope: gcfg.tope_dia },
        minimax: { activo: minimaxOn(), usado_caracteres: m.chars, tope_caracteres: mcfg.tope_caracteres_dia },
      };
    },
  };
}
