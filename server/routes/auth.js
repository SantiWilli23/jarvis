import { Router } from "express";
import { get } from "../db/client.js";
import { verifyPassword } from "../auth/password.js";
import { sessionCookie, clearCookie, cookieToken, tieneCabeceraCliente, requireAuth } from "../auth/middleware.js";

export function authRoutes(ctx) {
  const r = Router();
  r.post("/login", async (req, res, next) => {
    try {
      const password = String(req.body?.password ?? "");
      const keys = [`ip:${req.ip}`]; // por IP (no por cuenta): nadie puede bloquear al dueño a propósito desde otra IP
      const lock = await ctx.limiter.check(keys);
      if (lock.locked) {
        res.set("Retry-After", String(Math.ceil(lock.retryAfterMs / 1000)));
        return res.status(429).json({ error: "bloqueado", retry_after_s: Math.ceil(lock.retryAfterMs / 1000) });
      }
      const owner = await get(ctx.db, "SELECT id, name, password_hash FROM users WHERE role='dueno' ORDER BY id LIMIT 1");
      const ok = !!(owner?.password_hash && password && await verifyPassword(password, owner.password_hash));
      await ctx.limiter.record(keys, ok, owner ? Number(owner.id) : null);
      if (!ok) {
        await ctx.audit.log({ userId: owner ? Number(owner.id) : null, action: "login.fallido", detail: req.ip });
        return res.status(401).json({ error: "contrasena_incorrecta" });
      }
      const { token, deviceId } = await ctx.sessions.create(Number(owner.id), { name: String(req.body?.deviceName || "Navegador").slice(0, 60), kind: "web" });
      await ctx.audit.log({ userId: Number(owner.id), action: "login.ok", detail: `dispositivo ${deviceId}` });
      res.append("Set-Cookie", sessionCookie(req, token));
      res.json({ token, user: { name: owner.name } });
    } catch (e) { next(e); }
  });
  r.post("/logout", requireAuth(ctx.sessions), async (req, res, next) => {
    try { await ctx.sessions.revokeByToken(req.sessionToken); ctx.hub?.dropDevice(req.device.id); res.append("Set-Cookie", clearCookie(req)); res.json({ ok: true }); } catch (e) { next(e); }
  });
  r.get("/me", requireAuth(ctx.sessions), (req, res) => res.json({ user: { name: req.user.name }, device: req.device }));
  // Si el navegador perdió localStorage pero la cookie sigue viva: devuelve el token para guardarlo otra vez (solo cookie válida + cabecera propia).
  r.post("/restore", async (req, res, next) => {
    try {
      if (!tieneCabeceraCliente(req)) return res.status(403).json({ error: "falta_cabecera" });
      const token = cookieToken(req);
      const s = token ? await ctx.sessions.verify(token) : null;
      if (!s || s.device.kind !== "web") return res.status(401).json({ error: "no_autorizado" });
      res.json({ token, user: { name: s.user.name }, device: s.device });
    } catch (e) { next(e); }
  });
  return r;
}
