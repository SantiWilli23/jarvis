import { Router } from "express";
import { classify } from "../router/classify.js";

export function ttsRoutes(ctx) {
  const r = Router();
  // 200 + audio, o 204 (cabecera X-Voice: browser) para que el navegador use speechSynthesis.
  r.post("/", async (req, res) => {
    try {
      const text = typeof req.body?.text === "string" ? req.body.text : "";
      if (!text.trim() || text.length > 5000) return res.status(400).json({ error: "texto_invalido" });
      const isPrivate = !!req.body?.private || classify(text).private;
      const out = await ctx.tts.synth({ userId: req.user.id, text, isPrivate });
      if (!out) return res.set("X-Voice", "browser").status(204).end();
      res.set({ "Content-Type": out.mime, "X-Voice": out.source, "Cache-Control": "no-store" }).send(out.data);
    } catch {
      res.set("X-Voice", "browser").status(204).end();
    }
  });
  return r;
}
