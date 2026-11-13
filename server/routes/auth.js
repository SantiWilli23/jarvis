import { Router } from "express";
import { get } from "../db/client.js";
import { verifyPassword } from "../auth/password.js";
import { bearer, requireAuth } from "../auth/middleware.js";

export function authRoutes(ctx) {
  const r = Router();
  r.post("/login", async (req, res, next) => {
    try {
      const password = String(req.body?.password ?? "");
      const keys = ["u:owner", `ip:${req.ip}`];
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
      res.json({ token, user: { name: owner.name } });
    } catch (e) { next(e); }
  });
  r.post("/logout", requireAuth(ctx.sessions), async (req, res, next) => {
    try { await ctx.sessions.revokeByToken(bearer(req)); ctx.hub?.dropDevice(req.device.id); res.json({ ok: true }); } catch (e) { next(e); }
  });
  r.get("/me", requireAuth(ctx.sessions), (req, res) => res.json({ user: { name: req.user.name }, device: req.device }));
  return r;
}
