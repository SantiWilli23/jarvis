import { Router } from "express";

// Cola del PC.
//  - Con sesión web (/api/pc/*): ver catálogo e historial, encolar, aprobar/rechazar.
//  - Con token "pc" (/api/agent/pc/*): el PC reclama la siguiente acción y devuelve su resultado.
const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };
const STATUS_ERR = { accion_desconocida: 400, no_encontrada: 404, estado_invalido: 409, pc_apagado: 409 };
const codeOf = (e) => STATUS_ERR[e] || 400;

export function pcRoutes(ctx) {
  const r = Router();
  r.get("/actions", wrap(async (req, res) => {
    const uid = Number(req.user.id);
    res.json({ pc_en_linea: ctx.pc.pcOnline(), catalogo: ctx.pc.catalog(), apps: ctx.pc.config.apps || [], acciones: await ctx.pc.list(uid) });
  }));
  r.post("/actions", wrap(async (req, res) => {
    const b = req.body && typeof req.body === "object" ? req.body : {};
    const out = await ctx.pc.create({ userId: Number(req.user.id), action: b.accion ?? b.action, params: b.params, source: "web" });
    res.status(out.ok ? 201 : codeOf(out.error)).json(out.ok ? { action: out.item } : { error: out.error });
  }));
  r.get("/actions/:id", wrap(async (req, res) => {
    const it = await ctx.pc.get(Number(req.user.id), Number(req.params.id));
    res.status(it ? 200 : 404).json(it ? { action: it } : { error: "no_encontrada" });
  }));
  r.post("/actions/:id/approve", wrap(async (req, res) => {
    const out = await ctx.pc.decide(Number(req.user.id), Number(req.params.id), req.body?.aprobar !== false);
    res.status(out.ok ? 200 : codeOf(out.error)).json(out.ok ? { action: out.item } : { error: out.error });
  }));
  return r;
}

export function agentPcRoutes(ctx) {
  const r = Router();
  r.post("/next", wrap(async (req, res) => {
    res.json({ accion: await ctx.pc.next(Number(req.user.id)) });
  }));
  r.post("/:id/result", wrap(async (req, res) => {
    const b = req.body && typeof req.body === "object" ? req.body : {};
    const out = await ctx.pc.result(Number(req.user.id), Number(req.params.id), { ok: b.ok !== false, texto: b.texto ?? b.result ?? "", datos: b.datos ?? null });
    res.status(out.ok ? 200 : codeOf(out.error)).json(out.ok ? { ok: true, status: out.item.status } : { ok: false, error: out.error });
  }));
  return r;
}
