import express, { Router } from "express";
import { ENGINES } from "../queue/tasks.js";

export const GEMINI_APAGADO = "Gemini del PC está apagado, señor (motores_pc.gemini.activo=false). Use Claude o Flash, o enciéndalo en config/providers.json.";
export function taskRoutes(ctx) {
  const r = Router();
  const view = (t) => t && ({ id: t.id, seq: t.seq, mode: t.mode, status: t.status, text: t.text, sha256: t.sha256, header: t.header, prepared: t.prepared, review_first: t.review_first, engine: t.engine, result: t.result });

  r.get("/", async (req, res, next) => {
    try { res.json({ tasks: (await ctx.tasks.list(req.user.id, { status: req.query.status })).map(view) }); } catch (e) { next(e); }
  });
  r.post("/", async (req, res, next) => {
    try {
      const text = req.body?.text;
      if (typeof text !== "string" || !text.length) return res.status(400).json({ error: "texto_vacio" });
      const engine = req.body.engine ?? "claude";
      if (!ENGINES.includes(engine)) return res.status(400).json({ error: "motor_invalido" }); // lista cerrada
      if (engine === "gemini" && !ctx.agent?.geminiActive?.()) return res.status(409).json({ error: "gemini_apagado", message: GEMINI_APAGADO });
      // Privacidad ANTES de encolar para Gemini: lo privado nunca va allí.
      if (engine === "gemini" && await ctx.chat.checkPrivate({ userId: req.user.id, text, flagPrivate: !!req.body.private })) return res.status(409).json({ error: "privado_no_gemini" });
      if (req.body.mode === "preparar") {
        const t = await ctx.prepare.prepare({ userId: req.user.id, text, isPrivate: !!req.body.private, reviewFirst: req.body.reviewFirst !== false, engine });
        return res.status(201).json({ task: view(t) });
      }
      const t = await ctx.direct.enqueue({ userId: req.user.id, text, engine });
      res.status(201).json({ task: view(t) });
    } catch (e) { next(e); }
  });
  r.patch("/:id", async (req, res, next) => {
    try {
      const out = await ctx.tasks.update(req.user.id, Number(req.params.id), { rawText: req.body?.text });
      res.status(out.ok ? 200 : 409).json(out.ok ? { task: view(out.task) } : { error: out.reason });
    } catch (e) { next(e); }
  });
  r.delete("/:id", async (req, res, next) => {
    try {
      const out = await ctx.tasks.remove(req.user.id, Number(req.params.id));
      res.status(out.ok ? 200 : 409).json(out.ok ? { ok: true } : { error: out.reason });
    } catch (e) { next(e); }
  });
  // "Pasar a Claude": una tarea de Gemini que falló o se rechazó vuelve a la cola, ahora para Claude.
  r.post("/:id/pass-to-claude", async (req, res, next) => {
    try {
      const out = await ctx.tasks.reassign(req.user.id, Number(req.params.id), "claude");
      res.status(out.ok ? 200 : 409).json(out.ok ? { task: view(out.task) } : { error: out.reason });
    } catch (e) { next(e); }
  });
  r.post("/:id/approve-review", async (req, res, next) => {
    try {
      const out = await ctx.tasks.approveReview(req.user.id, Number(req.params.id));
      res.status(out.ok ? 200 : 409).json(out.ok ? { task: view(out.task) } : { error: "no_en_revision" });
    } catch (e) { next(e); }
  });
  r.post("/:id/attachments", express.raw({ type: "image/*", limit: "5mb" }), async (req, res, next) => {
    try {
      const out = await ctx.tasks.addAttachment({ userId: req.user.id, taskId: Number(req.params.id), mime: req.headers["content-type"], data: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0) });
      res.status(out.ok ? 201 : 409).json(out.ok ? out : { error: out.reason });
    } catch (e) { next(e); }
  });
  return r;
}
