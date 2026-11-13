import { Router } from "express";
import { ProError } from "../pro/index.js";

// /api/agent/pro/*: el PC (token "pc"). Contrato: docs/PRO.md §5. Todo es idempotente: el PC puede reenviar.
export function agentProRoutes(ctx) {
  const r = Router();
  const o = () => ctx.pro.orch;
  const w = (fn, code = 200) => async (req, res, next) => {
    try { const out = await fn(req); res.status(code).json(out); }
    catch (e) { if (e instanceof ProError) res.status(e.status).json({ error: e.code, ...e.extra }); else next(e); }
  };
  const id = (req) => Number(req.params.id);
  r.get("/status", w((req) => ctx.pro.status(req.user.id)));
  r.post("/claim", w((req) => o().claim(req.user.id, req.body || {})));
  r.post("/jobs/:id/events", w((req) => o().events(req.user.id, id(req), req.body?.events)));
  r.post("/jobs/:id/report", w((req) => o().report(req.user.id, id(req), req.body || {})));
  r.post("/jobs/:id/fail", w((req) => o().fail(req.user.id, id(req), req.body || {})));
  r.post("/jobs/:id/approval", w((req) => o().requestApproval(req.user.id, id(req), req.body || {}), 201));
  r.get("/approvals/:id", w(async (req) => { const s = await ctx.agent.approvalStatus(req.user.id, id(req)); if (!s) throw new ProError(404, "no_existe"); return s; }));
  return r;
}
