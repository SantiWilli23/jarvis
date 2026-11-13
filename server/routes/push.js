import { Router } from "express";

// Web Push: solo con sesión web (el token "phone" del Atajo recibe 403 por requireAuth en app.js).
export function pushRoutes(ctx) {
  const r = Router();
  r.get("/vapid", async (_req, res, next) => {
    try {
      const k = await ctx.push.publicKey();
      res.status(k ? 200 : 503).json(k ? { publicKey: k } : { error: "push_no_disponible" });
    } catch (e) { next(e); }
  });
  r.post("/subscribe", async (req, res, next) => {
    try {
      const out = await ctx.push.subscribe(Number(req.user.id), req.device?.id, req.body?.subscription || req.body);
      res.status(out.ok ? 201 : 400).json(out.ok ? { ok: true } : { error: out.error });
    } catch (e) { next(e); }
  });
  r.delete("/subscribe", async (req, res, next) => {
    try { res.json(await ctx.push.unsubscribe(Number(req.user.id), req.body?.endpoint)); } catch (e) { next(e); }
  });
  return r;
}
