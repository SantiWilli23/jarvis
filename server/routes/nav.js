import { Router } from "express";

// /api/agent/nav/*: solo el PC (token "pc"). Contrato en docs/NAV.md.
export function agentNavRoutes(ctx) {
  const r = Router(), n = ctx.nav;
  r.post("/claim", async (req, res, next) => { try { res.json(await n.claim(req.user.id, req.device.id)); } catch (e) { next(e); } });
  r.post("/:id/result", async (req, res, next) => {
    try { res.json(await n.result(req.user.id, req.device.id, Number(req.params.id) || 0, req.body || {})); }
    catch (e) { if (e?.error) res.status(e.status || 400).json({ error: e.error }); else next(e); }
  });
  return r;
}
