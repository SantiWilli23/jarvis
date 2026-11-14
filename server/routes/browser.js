import { Router } from "express";

// /api/browser/*: sesión web del señor. /api/agent/browser/*: solo el PC (token "pc").
const fail = (res, e, next) => (e?.error ? res.status(e.status || 400).json({ error: e.error, mensaje: e.mensaje }) : next(e));

export function browserRoutes(ctx) {
  const r = Router(), b = ctx.browser;
  r.get("/status", async (req, res, next) => { try { res.json(await b.status(req.user.id)); } catch (e) { next(e); } });
  r.get("/tasks", async (req, res, next) => { try { res.json({ tasks: await b.list(req.user.id) }); } catch (e) { next(e); } });
  r.post("/tasks", async (req, res, next) => {
    try { res.status(201).json({ task: await b.enqueue({ userId: req.user.id, site: String(req.body?.site || ""), prompt: req.body?.prompt, flagPrivate: !!req.body?.private }) }); } catch (e) { fail(res, e, next); }
  });
  r.get("/tasks/:id", async (req, res, next) => {
    try { const t = await b.get(req.user.id, Number(req.params.id)); t ? res.json({ task: t }) : res.status(404).json({ error: "no_existe" }); } catch (e) { next(e); }
  });
  r.post("/tasks/:id/cancel", async (req, res, next) => { try { res.json({ task: await b.cancel(req.user.id, Number(req.params.id)) }); } catch (e) { next(e); } });
  return r;
}

export function agentBrowserRoutes(ctx) {
  const r = Router(), b = ctx.browser;
  r.post("/claim", async (req, res, next) => { try { res.json(await b.claim(req.user.id)); } catch (e) { next(e); } });
  r.post("/tasks/:id/step", async (req, res, next) => { try { res.json(await b.step(req.user.id, Number(req.params.id), req.body || {})); } catch (e) { fail(res, e, next); } });
  return r;
}
