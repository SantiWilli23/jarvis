import { Router } from "express";
import { classify } from "../router/classify.js";

export function ttsRoutes(ctx) {
  const r = Router();
  // 200 + audio, o 204 (cabecera X-Voice: browser) para que el navegador use speechSynthesis.
  const enviar = (res, out) => {
    if (!out) return res.set("X-Voice", "browser").status(204).end();
    res.set({ "Content-Type": out.mime, "X-Voice": out.source, "Cache-Control": "no-store" }).send(out.data);
  };
  // Audio que /api/chat dejó preparándose (voz.partes[].id). Solo para el mismo usuario.
  r.get("/:id", async (req, res) => {
    try {
      const j = ctx.tts.trabajo({ userId: req.user.id, id: req.params.id });
      if (!j) return res.status(404).json({ error: "no_encontrado" });
      enviar(res, await j.audio);
    } catch {
      enviar(res, null);
    }
  });
  r.post("/", async (req, res) => {
    try {
      const text = typeof req.body?.text === "string" ? req.body.text : "";
      if (!text.trim() || text.length > 5000) return res.status(400).json({ error: "texto_invalido" });
      const isPrivate = !!req.body?.private || classify(text).private;
      const out = await ctx.tts.synth({ userId: req.user.id, text, isPrivate });
      enviar(res, out);
    } catch {
      enviar(res, null);
    }
  });
  return r;
}
