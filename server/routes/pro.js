import { Router } from "express";

// /api/pro/*: la web (sesión "web"). STUB: P2 completa hilos, mensajes, decisiones y diffs (docs/PRO.md).
export function proRoutes(ctx) {
  const r = Router();
  r.get("/status", async (req, res, next) => { try { res.json(await ctx.pro.status(req.user.id)); } catch (e) { next(e); } });
  return r;
}
