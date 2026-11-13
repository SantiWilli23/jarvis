import { Router } from "express";

export function approvalRoutes(ctx) {
  const r = Router();
  r.get("/", async (req, res, next) => { try { res.json({ approvals: await ctx.approvals.pending(req.user.id) }); } catch (e) { next(e); } });
  // Crear un pedido a mano (el runner del PC lo hará en la Fase 2); útil para probar la tarjeta ámbar.
  r.post("/", async (req, res, next) => {
    try {
      const { kind, summary, detail, taskId } = req.body || {};
      if (!kind || !summary) return res.status(400).json({ error: "faltan_datos" });
      res.status(201).json({ approval: await ctx.approvals.request({ userId: req.user.id, taskId, kind, summary: String(summary), detail: String(detail || "") }) });
    } catch (e) { next(e); }
  });
  r.post("/:id", async (req, res, next) => {
    try {
      const a = await ctx.approvals.decide(req.user.id, Number(req.params.id), !!req.body?.approve);
      res.status(a ? 200 : 404).json(a ? { approval: a } : { error: "no_pendiente" });
    } catch (e) { next(e); }
  });
  return r;
}
