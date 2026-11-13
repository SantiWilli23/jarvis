import { Router } from "express";

// /api/agent/pro/*: el PC (token "pc"). STUB: P2 añade claim/events/report de jobs (docs/PRO.md).
export function agentProRoutes(ctx) {
  const r = Router();
  r.get("/status", async (req, res, next) => { try { res.json(await ctx.pro.status(req.user.id)); } catch (e) { next(e); } });
  return r;
}
