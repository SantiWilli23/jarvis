import { Router } from "express";

// Widget de Atajos de iPhone: solo acepta tokens de dispositivo tipo "shortcut".
export function shortcutRoutes(ctx) {
  const r = Router();
  r.post("/", async (req, res, next) => {
    try {
      const text = typeof req.body?.text === "string" ? req.body.text : "";
      const out = await ctx.chat.handle({ userId: req.user.id, text, flagPrivate: !!req.body?.private, source: "atajo" });
      res.json({ status: out.status, reply: out.reply });
    } catch (e) { next(e); }
  });
  return r;
}
