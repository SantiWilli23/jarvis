// Charla en vivo con Gemini Live (docs/CONVERSA.md). El servidor solo emite un token efímero: la API key nunca sale.
// El audio va directo del navegador a Google. El token no se guarda ni se registra.
import express, { Router } from "express";
import { randomUUID } from "node:crypto";
import { get, run } from "./db/client.js";
import { classify, RE_PRIVADO } from "./router/classify.js";

const URL_TOKEN = "https://generativelanguage.googleapis.com/v1beta/auth_tokens";
// Campos que el cliente no puede sobrescribir. "tools" va en la máscara y no en el setup: así no hay ninguna.
// sessionResumption queda fuera para que el cliente reanude con el mismo token.
export const FIELD_MASK = "model,generationConfig,systemInstruction,outputAudioTranscription,tools,inputAudioTranscription,contextWindowCompression,realtimeInputConfig";
const MIN_SEG = 30;
const MAX_TURNOS = 200, MAX_TEXTO = 4000;

export const ANEXO_VIVO = "\n\nCHARLA EN VIVO POR VOZ: hable en español con frases cortas. El señor puede interrumpirle: si lo hace, deje lo que decía y atiéndalo. El saludo ya se dio: no vuelva a saludar. En esta charla solo conversa: no tiene herramientas, no busca en la web, no usa el PC ni el teléfono y no anota nada en la cola. No conoce su memoria ni charlas anteriores. Si le piden correo, Drive, notas privadas, búsquedas o acciones, diga que se lo pida en el modo normal.";

const err = (status, error, mensaje) => ({ status, error, mensaje });
const dia = (t) => "d:" + new Date(t).toISOString().slice(0, 10); // mismo corte diario (UTC) que la voz

export function createConversa({ db, env = {}, fetch: f = globalThis.fetch, config = {}, persona = "", control = null, audit = null, now = () => Date.now() }) {
  const cfg = { enabled: false, modelo: "gemini-3.8-live", voz: "Enceladus", tope_minutos_dia: 60, max_min_sesion: 15, ...config };
  const tope = Math.round(cfg.tope_minutos_dia * 60);

  const setup = () => ({
    model: `models/${cfg.modelo}`,
    generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: cfg.voz } } } },
    systemInstruction: { parts: [{ text: persona + ANEXO_VIVO }] },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    contextWindowCompression: { slidingWindow: {} },
  });

  // El tope se cuenta reservando al emitir: aunque el cliente nunca llame a /fin, lo reservado queda gastado.
  // En provider_usage, "tokens" son los segundos del día.
  async function reservar(userId) {
    const t = now(), k = dia(t);
    await run(db, "INSERT INTO provider_usage (user_id, provider, window_key, count, tokens, created_at) VALUES (?,'live',?,0,0,?) ON CONFLICT(user_id, provider, window_key) DO NOTHING", [userId, k, t]);
    for (let i = 0; i < 3; i++) { // dos pedidos a la vez: la actualización condicional no deja pasar del tope
      const usado = Number((await get(db, "SELECT tokens FROM provider_usage WHERE user_id=? AND provider='live' AND window_key=?", [userId, k])).tokens);
      const seg = Math.min(Math.round(cfg.max_min_sesion * 60), tope - usado);
      if (seg < MIN_SEG) break;
      const r = await run(db, "UPDATE provider_usage SET tokens = tokens + ?, count = count + 1 WHERE user_id=? AND provider='live' AND window_key=? AND tokens + ? <= ?", [seg, userId, k, seg, tope]);
      if (r.changes) return { seg, k, inicio: t };
    }
    throw err(429, "tope_dia", "Se acabaron los minutos de charla de hoy, señor.");
  }
  const devolver = (userId, k, seg) => run(db, "UPDATE provider_usage SET tokens = MAX(0, tokens - ?) WHERE user_id=? AND provider='live' AND window_key=?", [seg, userId, k]);

  async function token(userId) {
    if (!cfg.enabled || !env.GEMINI_API_KEY) throw err(409, "desactivado", "La charla en vivo está desactivada, señor.");
    if (await control?.frenado(userId)) throw err(409, "frenado", "El freno está puesto, señor. Reanude desde la web.");
    const r = await reservar(userId);
    let name = null, estado = "sin_red";
    try {
      const res = await f(URL_TOKEN, {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: { "x-goog-api-key": env.GEMINI_API_KEY, "content-type": "application/json" },
        body: JSON.stringify({
          uses: 1,
          expireTime: new Date(r.inicio + r.seg * 1000).toISOString(), // Google corta ahí: tope por sesión
          newSessionExpireTime: new Date(r.inicio + Math.min(120, r.seg) * 1000).toISOString(),
          bidiGenerateContentSetup: setup(),
          fieldMask: FIELD_MASK,
        }),
      });
      estado = res.status;
      if (res.ok) name = (await res.json())?.name || null;
    } catch { /* sin red o respuesta rota */ }
    if (!name) {
      await devolver(userId, r.k, r.seg);
      console.error("[conversa] no hubo token:", estado); // solo el estado: nunca el cuerpo ni la clave
      throw err(502, "sin_token", "Google no me dio acceso a la charla, señor.");
    }
    const id = randomUUID();
    await run(db, "DELETE FROM settings WHERE user_id=? AND key LIKE 'conversa:%' AND created_at < ?", [userId, r.inicio - 86_400_000]);
    await run(db, "INSERT INTO settings (user_id, key, value, created_at) VALUES (?,?,?,?)", [userId, "conversa:" + id, JSON.stringify(r), r.inicio]);
    await audit?.log({ userId, action: "conversa.inicio", detail: `${Math.ceil(r.seg / 60)} min reservados` });
    return { id, token: name, modelo: `models/${cfg.modelo}`, segundos: r.seg, privado: { source: RE_PRIVADO.source, flags: RE_PRIVADO.flags } };
  }

  async function guardar(userId, turnos) {
    const limpios = (Array.isArray(turnos) ? turnos : []).slice(0, MAX_TURNOS)
      .map((x) => ({ role: x?.role === "assistant" ? "assistant" : "user", texto: typeof x?.texto === "string" ? x.texto.trim().slice(0, MAX_TEXTO) : "" }))
      .filter((x) => x.texto);
    // Si el señor dijo algo privado, no se guarda nada de la charla.
    if (!limpios.length || limpios.some((x) => x.role === "user" && classify(x.texto).private)) return null;
    const titulo = "En vivo: " + (limpios.find((x) => x.role === "user") || limpios[0]).texto.slice(0, 50);
    const conv = (await run(db, "INSERT INTO conversations (user_id, title, created_at) VALUES (?,?,?)", [userId, titulo, now()])).id;
    for (const x of limpios) await run(db, "INSERT INTO messages (user_id, conversation_id, role, content, provider, private, created_at) VALUES (?,?,?,?,'conversa',0,?)", [userId, conv, x.role, x.texto, now()]);
    return Number(conv);
  }

  // Los minutos usados los mide el servidor (desde que emitió el token), no el cliente. Solo vale una vez.
  async function fin(userId, { id, turnos } = {}) {
    const key = "conversa:" + String(id ?? "").slice(0, 60);
    const fila = await get(db, "SELECT value FROM settings WHERE user_id=? AND key=?", [userId, key]);
    if (!fila || !(await run(db, "DELETE FROM settings WHERE user_id=? AND key=?", [userId, key])).changes) throw err(404, "sin_charla", "Esa charla ya se cerró.");
    const r = JSON.parse(fila.value);
    const usado = Math.min(r.seg, Math.max(0, Math.ceil((now() - r.inicio) / 1000)));
    await devolver(userId, r.k, r.seg - usado);
    const conversationId = await guardar(userId, turnos);
    await audit?.log({ userId, action: "conversa.fin", detail: `${usado} s` });
    return { segundos: usado, conversationId };
  }

  const wrap = (fn) => async (req, res, next) => {
    try { res.json(await fn(Number(req.user.id), req.body && typeof req.body === "object" ? req.body : {})); }
    catch (e) { if (e?.error) res.status(e.status).json({ error: e.error, mensaje: e.mensaje }); else next(e); }
  };

  return {
    token, fin,
    // /api/conversa (solo sesión web)
    routes() {
      const r = Router();
      r.use(express.json({ limit: "1mb" }));
      r.post("/token", wrap((uid) => token(uid)));
      r.post("/fin", wrap((uid, body) => fin(uid, body)));
      return r;
    },
  };
}
