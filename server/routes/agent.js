import { Router } from "express";

// /api/agent/*: solo para dispositivos de tipo "pc" (token de agente). Un token web o de atajo recibe 403.
export function agentRoutes(ctx) {
  const r = Router();
  const a = ctx.agent;
  const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };
  const tid = (req) => Number(req.params.id);

  r.post("/hello", wrap(async (req, res) => res.json(await a.hello(req.user.id, req.body || {}))));
  r.post("/heartbeat", wrap(async (req, res) => res.json(await a.heartbeat(req.user.id, req.body || {}))));
  r.post("/bye", wrap(async (req, res) => res.json(await a.bye(req.user.id))));
  // Entrega la siguiente tarea. 200 siempre; task:null + reason si no hay o se llegó al tope.
  r.post("/claim", wrap(async (req, res) => {
    const out = await a.claim(req.user.id);
    res.json(out.task ? { ...out, task: viewTask(out.task) } : out);
  }));
  r.post("/tasks/:id/events", wrap(async (req, res) => {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    const out = await a.progress(req.user.id, tid(req), events);
    res.status(out.ok ? 200 : 404).json(out.ok ? out : { error: out.reason });
  }));
  r.post("/tasks/:id/approval", wrap(async (req, res) => {
    const { kind, summary, detail } = req.body || {};
    if (!kind || !summary) return res.status(400).json({ error: "faltan_datos" });
    res.status(201).json({ approval: await a.requestApproval(req.user.id, tid(req), { kind, summary, detail }) });
  }));
  r.get("/approvals/:id", wrap(async (req, res) => {
    const s = await a.approvalStatus(req.user.id, Number(req.params.id));
    res.status(s ? 200 : 404).json(s || { error: "no_existe" });
  }));
  r.post("/tasks/:id/finish", wrap(async (req, res) => {
    const out = await a.finish(req.user.id, tid(req), req.body || {});
    res.status(out.ok ? 200 : 409).json(out.ok ? { ok: true } : { error: out.reason });
  }));
  return r;
}

// El texto viaja como cadena UTF-8 y con su sha256 para que el agente verifique que llegó intacto.
const viewTask = (t) => ({ id: t.id, seq: t.seq, mode: t.mode, engine: t.engine, text: t.text, sha256: t.sha256, header: t.header, prepared: t.prepared });
