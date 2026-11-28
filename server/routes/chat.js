import { Router } from "express";
import { classify } from "../router/classify.js";

// Deja la voz preparándose (sin esperar el audio). Mismas reglas que /api/tts: lo privado y lo escolar, nunca.
// Un fallo de voz no rompe la respuesta. Con el freno puesto solo se ofrecen pregrabadas.
async function vozDe(ctx, userId, { text, flag, out }) {
  try {
    const reply = String(out.reply ?? "");
    if (!reply.trim() || out.status === "escolar" || out.status === "juego") return null; // juego: el cliente no habla
    if (flag || out.private || classify(text).private || classify(reply).private) return null;
    if (out.private === undefined && (await ctx.chat.checkPrivate({ userId, text }))) return null;
    const soloLocal = out.status === "frenado" || !!(await ctx.control?.frenado(userId));
    // Sin voz de servidor para este texto: el cliente habla de una vez, sin otro viaje a /api/tts.
    return (await ctx.tts.preparar({ userId, text: reply, soloLocal })) || { navegador: true };
  } catch (e) {
    console.error("[chat] voz", e?.message);
    return null;
  }
}

export function chatRoutes(ctx) {
  const r = Router();
  r.post("/", async (req, res, next) => {
    try {
      const text = typeof req.body?.text === "string" ? req.body.text : "";
      if (text.length > 20000) return res.status(413).json({ error: "texto_largo" });
      const out = await ctx.chat.handle({ userId: req.user.id, deviceId: req.device?.id ?? null, text, conversationId: req.body?.conversationId, flagPrivate: !!req.body?.private, source: req.body?.source || "texto", engine: req.body?.engine, reproductor: { activo: !!req.body?.reproductor?.activo },
        origen: ["pc", "movil"].includes(req.body?.origen) ? req.body.origen : /iPhone|iPad|Android|Mobile/i.test(req.headers["user-agent"] || "") ? "movil" : "pc" });
      const voz = req.body?.voz === true ? await vozDe(ctx, req.user.id, { text, flag: !!req.body?.private, out }) : null;
      res.json(voz ? { ...out, voz } : out);
    } catch (e) { next(e); }
  });
  return r;
}
