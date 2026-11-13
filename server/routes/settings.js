import { Router } from "express";
import { getModo, setModo, MODOS } from "../settings.js";

export function settingsRoutes(ctx) {
  const r = Router();
  r.get("/", async (req, res, next) => {
    try { res.json({ modo: await getModo(ctx.db, req.user.id) }); } catch (e) { next(e); }
  });
  r.put("/", async (req, res, next) => {
    try {
      const modo = req.body?.modo;
      if (typeof modo !== "string" || !MODOS.includes(modo)) return res.status(400).json({ error: "modo_invalido", validos: MODOS });
      res.json({ modo: await setModo(ctx.db, req.user.id, modo, ctx.now ? ctx.now() : Date.now()) });
    } catch (e) { next(e); }
  });
  return r;
}
