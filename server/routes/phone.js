import { Router } from "express";
import { bearer, requireAuth } from "../auth/middleware.js";
import { run } from "../db/client.js";

// Cola del teléfono.
//  - Con sesión web:  POST/GET /api/phone/actions  (crear acciones, ver catálogo e historial)
//  - Con token "phone" (el del Atajo "Jarvis Puente"): POST /api/phone/next, POST /api/phone/actions/:id/done y
//    POST /api/phone/disparador (solo lanza una escena de la lista cerrada, para automatizaciones de iOS).
//    Ese token no sirve para nada más (chat, WebSocket, aprobaciones: 403).
const LIMITE = 60, VENTANA_MS = 60_000;
const DISPAROS_HORA = 10, HORA_MS = 60 * 60_000;

export function phoneRoutes(ctx) {
  const r = Router();
  const hits = new Map(); // deviceId -> marcas de tiempo de la última ventana

  function limited(deviceId) {
    const t = ctx.now();
    const arr = (hits.get(deviceId) || []).filter((x) => t - x < VENTANA_MS);
    if (arr.length >= LIMITE) { hits.set(deviceId, arr); return Math.ceil((arr[0] + VENTANA_MS - t) / 1000); }
    arr.push(t); hits.set(deviceId, arr);
    if (hits.size > 500) for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] > VENTANA_MS) hits.delete(k);
    return 0;
  }

  // Autenticación del token "phone" con auditoría de rechazos (sin guardar el token).
  const phoneAuth = async (req, res, next) => {
    try {
      const tk = bearer(req);
      const s = await ctx.sessions.verify(tk);
      if (!s || s.device.kind !== "phone") {
        await ctx.audit.log({ userId: s?.user?.id ?? null, action: "phone.token_rechazado", detail: s ? `tipo ${s.device.kind}` : tk ? "token inválido" : "sin token" });
        return res.status(s ? 403 : 401).json({ error: s ? "dispositivo_no_permitido" : "no_autorizado" });
      }
      const wait = limited(s.device.id);
      if (wait) return res.status(429).set("Retry-After", String(wait)).json({ error: "demasiadas_peticiones", retry_after_s: wait });
      req.user = s.user; req.device = s.device;
      next();
    } catch (e) { next(e); }
  };

  r.post("/next", phoneAuth, async (req, res, next) => {
    try { res.json({ acciones: await ctx.phone.next(Number(req.user.id)) }); } catch (e) { next(e); }
  });
  r.post("/actions/:id/done", phoneAuth, async (req, res, next) => {
    try {
      const b = req.body && typeof req.body === "object" ? req.body : {};
      const ok = !(b.ok === false || b.ok === "false" || b.status === "fallida");
      const out = await ctx.phone.done(Number(req.user.id), Number(req.params.id), { ok, result: b.result ?? b.resultado ?? null, datos: b.datos ?? null });
      res.status(out.ok ? 200 : out.error === "no_encontrada" ? 404 : 409).json(out.ok ? { ok: true, status: out.item.status } : { ok: false, error: out.error });
    } catch (e) { next(e); }
  });

  // Automatizaciones de iOS: cuerpo exacto { escena }. Sin acciones sueltas ni parámetros libres.
  r.post("/disparador", phoneAuth, async (req, res, next) => {
    try {
      const uid = Number(req.user.id);
      const b = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
      const id = Object.keys(b).length === 1 && typeof b.escena === "string" ? b.escena : null;
      if (!id || !ctx.escenas.list().some((e) => e.id === id)) {
        await ctx.audit.log({ userId: uid, action: "escena.disparador_rechazado", detail: `dispositivo ${req.device.id}` });
        return res.status(400).json({ ok: false, error: id ? "escena_desconocida" : "cuerpo_invalido" });
      }
      // Tope por hora contado en la auditoría (sobrevive a reinicios); contar y apuntar en un solo INSERT.
      const t = ctx.now();
      const marca = await run(ctx.db, `INSERT INTO audit_log (user_id, action, detail, created_at) SELECT ?,'escena.disparador',?,?
        WHERE (SELECT COUNT(*) FROM audit_log WHERE user_id=? AND action='escena.disparador' AND created_at > ?) < ?`,
        [uid, `${id} dispositivo ${req.device.id}`, t, uid, t - HORA_MS, DISPAROS_HORA]);
      if (!marca.changes) {
        await ctx.audit.log({ userId: uid, action: "escena.disparador_tope", detail: id });
        return res.status(429).json({ ok: false, error: "tope_disparador" });
      }
      const out = await ctx.escenas.ejecutar({ userId: uid, id, source: "disparador", deviceId: req.device.id });
      res.json({ ok: out.ok, escena: id, resumen: out.resumen });
    } catch (e) { next(e); }
  });

  // Sesión web (cualquier otro tipo de dispositivo recibe 403/401 aquí)
  const web = requireAuth(ctx.sessions);
  r.get("/actions", web, async (req, res, next) => {
    try {
      const uid = Number(req.user.id);
      res.json({ atajo: ctx.phone.config.atajo_nombre || "Jarvis Puente", catalogo: ctx.phone.catalog(), enfoques: ctx.phone.config.enfoques_permitidos || [], atajos: ctx.phone.config.atajos_permitidos || [], acciones: await ctx.phone.list(uid), pendientes: await ctx.phone.counts(uid) });
    } catch (e) { next(e); }
  });
  r.get("/despertador", web, async (req, res, next) => {
    try { res.json({ configurado: await ctx.despertador.configurado(Number(req.user.id)), push: (await ctx.push.count(Number(req.user.id))) > 0 }); } catch (e) { next(e); }
  });
  r.post("/actions", web, async (req, res, next) => {
    try {
      const b = req.body && typeof req.body === "object" ? req.body : {};
      const { accion, action, ...rest } = b;
      const out = await ctx.phone.create({ userId: Number(req.user.id), action: String(accion || action || ""), args: rest, source: "web", deviceId: req.device?.id ?? null });
      res.status(out.ok ? 201 : 400).json(out.ok ? { action: out.item } : { error: out.error });
    } catch (e) { next(e); }
  });
  return r;
}
