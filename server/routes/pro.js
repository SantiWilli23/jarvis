import { Router } from "express";
import { ProError } from "../pro/index.js";

// /api/pro/*: la web (sesión "web"). Contrato: docs/PRO.md §4.
export function proRoutes(ctx) {
  const r = Router();
  const o = () => ctx.pro.orch;
  const w = (fn) => async (req, res, next) => {
    try { res.json(await fn(req, res)); }
    catch (e) { if (e instanceof ProError) res.status(e.status).json({ error: e.code, ...e.extra }); else next(e); }
  };
  const id = (req) => Number(req.params.id);
  r.get("/status", w((req) => ctx.pro.status(req.user.id)));
  r.get("/threads", w(async (req) => ({ threads: await o().store.listThreads(req.user.id) })));
  r.post("/threads", w(async (req, res) => { res.status(201); return { thread: await o().createThread(req.user.id, req.body || {}) }; }));
  r.get("/threads/:id", w(async (req) => { const v = await o().threadView(req.user.id, id(req)); if (!v) throw new ProError(404, "no_existe"); return v; }));
  r.post("/threads/:id/messages", w(async (req, res) => { const out = await o().send(req.user.id, id(req), req.body?.text, { privado: !!req.body?.privado }); res.status(201); return out; }));
  r.post("/rounds/:id/decision", w((req) => o().decide(req.user.id, id(req), req.body || {})));
  r.post("/rounds/:id/iniciar", w((req) => o().iniciar(req.user.id, id(req), req.body || {})));
  r.get("/coordinador", w((req) => o().coordinadorEstado(req.user.id)));
  r.post("/coordinador", w((req) => o().setCoordinador(req.user.id, !!req.body?.activo)));
  r.post("/rounds/:id/cancel", w((req) => o().cancel(req.user.id, id(req))));
  r.get("/jobs/:id", w(async (req) => { const v = await o().jobDetail(req.user.id, id(req)); if (!v) throw new ProError(404, "no_existe"); return v; }));
  return r;
}
