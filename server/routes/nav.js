import { Router } from "express";

const manejar = (fn) => async (req, res, next) => {
  try { res.json(await fn(req)); }
  catch (e) { if (e?.error) res.status(e.status || 400).json({ error: e.error }); else next(e); }
};
const id = (req) => Number(req.params.id) || 0;

// /api/agent/nav/*: solo el PC (token "pc"). Contrato en docs/NAV.md.
export function agentNavRoutes(ctx) {
  const r = Router(), n = ctx.nav;
  r.post("/claim", manejar((req) => n.claim(req.user.id, req.device.id)));
  r.post("/:id/events", manejar((req) => n.events(req.user.id, req.device.id, id(req), req.body || {})));
  r.post("/:id/result", manejar((req) => n.result(req.user.id, req.device.id, id(req), req.body || {})));
  return r;
}

// /api/nav/*: la web (sesión "web"): historial y cancelar.
export function navRoutes(ctx) {
  const r = Router(), n = ctx.nav;
  r.get("/tasks", manejar((req) => n.list(req.user.id, req.query.limit)));
  r.get("/tasks/:id", manejar((req) => n.ver(req.user.id, id(req))));
  r.post("/tasks/:id/cancel", manejar((req) => n.cancel(req.user.id, id(req))));
  return r;
}
