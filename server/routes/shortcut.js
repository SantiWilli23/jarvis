import { Router } from "express";
import { classify } from "../router/classify.js";

// Widget / Atajo de iPhone: solo acepta tokens de dispositivo tipo "shortcut" (se crea uno en
// POST /api/devices con kind "shortcut"; el token se ve una sola vez).
// Entrada: JSON con `text` (o `dictado`, `input`, `q`) o texto plano. Salida corta para que el Atajo la lea en voz alta:
//   JSON { status, reply, speak }   o   texto plano si se pide ?format=text (o Accept: text/plain).
// Con `voz: true` en el cuerpo (docs/ATAJO-JARVIS.md) se añaden `audio_b64` y `audio_mime` con la voz de Jarvis.
// Sin audio (privado, sin cupo, sin voz o demasiado grande) el Atajo lee la clave speak con "Hablar texto".
const MAX_IN = 2000, MAX_REPLY = 400;
export const MAX_AUDIO = 3 * 1024 * 1024; // bytes antes de Base64: de sobra para 400 caracteres en WAV
const LLAMADA = /^\s*(?:(?:hey|ey|oye)[\s,]+)?jarvis(?![\p{L}\p{N}])[\s,.:;!-]*/iu;

// "Hey Jarvis, qué hora es" -> "qué hora es". Si solo dijo el nombre, se deja tal cual.
export const sinLlamada = (t) => t.replace(LLAMADA, "") || t;

// Recorta en un fin de oración para que suene natural al leerlo en voz alta.
export function shortReply(s, max = MAX_REPLY) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return end > max * 0.4 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…";
}

// Ante la duda no hay audio: así el texto privado no sale a una voz de terceros. Un fallo de voz no rompe la respuesta.
async function audioDe(ctx, userId, { text, out, reply, flag }) {
  try {
    const isPrivate = flag || !!out.private || classify(text).private || classify(String(out.reply ?? "")).private
      || await ctx.chat.checkPrivate({ userId, text }); // no todas las salidas traen "private" (notas privadas)
    if (isPrivate) return null;
    const a = await ctx.tts.synth({ userId, text: reply, isPrivate });
    if (!a || a.data.length > MAX_AUDIO) return null;
    return { audio_b64: a.data.toString("base64"), audio_mime: a.mime };
  } catch (e) {
    console.error("[atajo] voz", e?.message);
    return null;
  }
}

export function shortcutRoutes(ctx) {
  const r = Router();
  r.post("/", async (req, res, next) => {
    try {
      const b = req.body && typeof req.body === "object" ? req.body : {};
      const voz = b.voz === true || b.voz === "true";
      let text = [b.text, b.dictado, b.input, b.q].find((v) => typeof v === "string" && v.trim()) || (typeof req.body === "string" ? req.body : "");
      if (!text.trim()) return res.status(400).json({ error: "falta_texto", reply: "No oí nada, señor." });
      if (text.length > MAX_IN) return res.status(413).json({ error: "texto_largo" });
      if (voz) text = sinLlamada(text);
      const out = await ctx.chat.handle({ userId: req.user.id, deviceId: req.device?.id ?? null, text, flagPrivate: !!b.private, source: "atajo" });
      const reply = shortReply(out.reply, voz ? MAX_REPLY - 1 : MAX_REPLY); // con "…" no pasa del máximo de la voz
      if (req.query.format === "text" || /text\/plain/.test(req.get("accept") || "")) return res.type("text/plain; charset=utf-8").send(reply);
      const audio = voz ? await audioDe(ctx, req.user.id, { text, out, reply, flag: !!b.private }) : null;
      res.json({ status: out.status, reply, speak: reply, ...audio });
    } catch (e) { next(e); }
  });
  return r;
}
