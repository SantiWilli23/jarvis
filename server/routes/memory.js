import { Router } from "express";

export function memoryRoutes(ctx) {
  const r = Router();
  r.get("/notes", async (req, res, next) => {
    try { res.json({ notes: await ctx.notes.list(req.user.id), counts: await ctx.notes.counts(req.user.id) }); } catch (e) { next(e); }
  });
  r.post("/notes", async (req, res, next) => {
    try {
      const { title, body, level } = req.body || {};
      const out = await ctx.notes.add({ userId: req.user.id, title: title || "", body, level: level || "normal" });
      // "secreta" no se guarda: se responde 200 con saved:false
      res.status(out.saved || out.reason === "secreta" ? 200 : 400).json(out);
    } catch (e) { next(e); }
  });
  r.delete("/notes/:id", async (req, res, next) => {
    try { res.json({ ok: await ctx.notes.remove(req.user.id, Number(req.params.id)) }); } catch (e) { next(e); }
  });
  r.get("/search", async (req, res, next) => {
    try {
      const k = Math.min(20, Number(req.query.k) || 5), tokenBudget = Math.min(4000, Number(req.query.tokens) || 800);
      res.json(await ctx.search.search({ userId: req.user.id, query: String(req.query.q || ""), k, tokenBudget }));
    } catch (e) { next(e); }
  });
  r.get("/inbox", async (req, res, next) => { try { res.json({ notes: await ctx.inbox.list(req.user.id) }); } catch (e) { next(e); } });
  r.post("/inbox/:id/approve", async (req, res, next) => { try { res.json({ ok: await ctx.inbox.approve(req.user.id, Number(req.params.id)) }); } catch (e) { next(e); } });
  r.post("/inbox/:id/reject", async (req, res, next) => { try { res.json({ ok: await ctx.inbox.reject(req.user.id, Number(req.params.id)) }); } catch (e) { next(e); } });
  return r;
}
