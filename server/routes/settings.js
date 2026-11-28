import { Router } from "express";
import { getModo, setModo, getNavCapturas, setNavCapturas, getNavElegirModelo, setNavElegirModelo, MODOS } from "../settings.js";

export function settingsRoutes(ctx) {
  const r = Router();
  // nav_capturas solo aparece cuando está encendido.
  const ver = async (userId) => {
    const elegir = await getNavElegirModelo(ctx.db, userId);
    return { modo: await getModo(ctx.db, userId), ...((await getNavCapturas(ctx.db, userId)) ? { nav_capturas: true } : {}), ...(elegir == null ? {} : { nav_elegir_modelo: elegir }) };
  };
  r.get("/", async (req, res, next) => {
    try { res.json(await ver(req.user.id)); } catch (e) { next(e); }
  });
  r.put("/", async (req, res, next) => {
    try {
      const { modo, nav_capturas: capturas, nav_elegir_modelo: elegir } = req.body || {};
      const soloCapturas = modo === undefined && (typeof capturas === "boolean" || typeof elegir === "boolean");
      if (!soloCapturas && (typeof modo !== "string" || !MODOS.includes(modo))) return res.status(400).json({ error: "modo_invalido", validos: MODOS });
      const t = ctx.now ? ctx.now() : Date.now();
      if (!soloCapturas) await setModo(ctx.db, req.user.id, modo, t);
      if (typeof capturas === "boolean") await setNavCapturas(ctx.db, req.user.id, capturas, t);
      if (typeof elegir === "boolean") await setNavElegirModelo(ctx.db, req.user.id, elegir, t);
      res.json(await ver(req.user.id));
    } catch (e) { next(e); }
  });
  return r;
}
