import { Router } from "express";

export function studioRoutes(ctx) {
  const r = Router();
  const fail = (res, e, next) => (e?.error ? res.status(e.status || 400).json({ error: e.error, mensaje: e.mensaje, max: e.max }) : next(e));
  r.get("/models", (_req, res) => res.json(ctx.studio.models()));
  r.get("/history", async (req, res, next) => {
    try { res.json({ messages: await ctx.studio.history(req.user.id, String(req.query.session || "")) }); } catch (e) { fail(res, e, next); }
  });
  r.delete("/history", async (req, res, next) => {
    try { await ctx.studio.clear(req.user.id, String(req.query.session || "")); res.json({ ok: true }); } catch (e) { fail(res, e, next); }
  });
  r.post("/chat", async (req, res, next) => {
    try {
      const b = req.body || {};
      res.json(await ctx.studio.send({ userId: req.user.id, text: b.text, model: b.model, session: String(b.session || ""), flagPrivate: !!b.private }));
    } catch (e) { fail(res, e, next); }
  });
  return r;
}
