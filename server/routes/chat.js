import { Router } from "express";

export function chatRoutes(ctx) {
  const r = Router();
  r.post("/", async (req, res, next) => {
    try {
      const text = typeof req.body?.text === "string" ? req.body.text : "";
      if (text.length > 20000) return res.status(413).json({ error: "texto_largo" });
      const out = await ctx.chat.handle({ userId: req.user.id, text, conversationId: req.body?.conversationId, flagPrivate: !!req.body?.private, source: req.body?.source || "texto", engine: req.body?.engine,
        origen: ["pc", "movil"].includes(req.body?.origen) ? req.body.origen : /iPhone|iPad|Android|Mobile/i.test(req.headers["user-agent"] || "") ? "movil" : "pc" });
      res.json(out);
    } catch (e) { next(e); }
  });
  return r;
}
