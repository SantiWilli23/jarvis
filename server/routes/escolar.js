import { Router } from "express";

// /api/escolar: solo sesión web. Contrato en docs/NAV.md.
export function escolarRoutes(ctx) {
  const r = Router(), e = ctx.escolar;
  const h = (fn) => async (req, res, next) => {
    try { res.set("Cache-Control", "no-store").json(await fn(req)); }
    catch (x) { if (x?.error) res.status(x.status || 400).json({ error: x.error, mensaje: x.mensaje }); else next(x); }
  };
  r.get("/", h((req) => e.resumen(req.user.id)));
  r.put("/cuentas", h(async (req) => {
    const v = req.body?.classroom_correo;
    if (typeof v !== "string") throw Object.assign(new Error("correo_invalido"), { error: "correo_invalido", status: 400 });
    return { classroom_correo: await e.setCorreo(req.user.id, v) };
  }));
  r.post("/actualizar", h(async (req) => ({ task_id: (await e.actualizar({ userId: req.user.id, fuente: String(req.body?.fuente || "") })).id })));
  return r;
}
