import { Router } from "express";

// Escenas desde la web (sesión "web"). El teléfono usa POST /api/phone/disparador (routes/phone.js).
export function escenaRoutes(ctx) {
  const r = Router();
  r.get("/", (_req, res) => res.json({ escenas: ctx.escenas.list() }));
  r.post("/:id", async (req, res, next) => {
    try {
      const out = await ctx.escenas.ejecutar({ userId: Number(req.user.id), id: req.params.id, source: "web", deviceId: req.device?.id ?? null });
      res.status(out.error === "escena_desconocida" ? 404 : 200).json(out);
    } catch (e) { next(e); }
  });
  return r;
}
