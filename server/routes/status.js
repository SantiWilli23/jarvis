import { Router } from "express";

export function statusRoutes(ctx) {
  const r = Router();
  r.get("/status", async (req, res, next) => { try { res.json(await ctx.status(req.user.id)); } catch (e) { next(e); } });
  r.get("/audit", async (req, res, next) => { try { res.json({ entries: await ctx.audit.list(req.user.id) }); } catch (e) { next(e); } });
  return r;
}
