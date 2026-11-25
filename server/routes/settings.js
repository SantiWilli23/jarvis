import { Router } from "express";
import { getModo, setModo, getNavCapturas, setNavCapturas, MODOS } from "../settings.js";

export function settingsRoutes(ctx) {
  const r = Router();
  // nav_capturas solo aparece cuando está encendido.
  const ver = async (userId) => ({ modo: await getModo(ctx.db, userId), ...((await getNavCapturas(ctx.db, userId)) ? { nav_capturas: true } : {}) });
  r.get("/", async (req, res, next) => {
    try { res.json(await ver(req.user.id)); } catch (e) { next(e); }
  });
  r.put("/", async (req, res, next) => {
    try {
      const { modo, nav_capturas: capturas } = req.body || {};
      const soloCapturas = modo === undefined && typeof capturas === "boolean";
      if (!soloCapturas && (typeof modo !== "string" || !MODOS.includes(modo))) return res.status(400).json({ error: "modo_invalido", validos: MODOS });
      const t = ctx.now ? ctx.now() : Date.now();
      if (!soloCapturas) await setModo(ctx.db, req.user.id, modo, t);
      if (typeof capturas === "boolean") await setNavCapturas(ctx.db, req.user.id, capturas, t);
      res.json(await ver(req.user.id));
    } catch (e) { next(e); }
  });
  return r;
}
