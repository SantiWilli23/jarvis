import { Router } from "express";

export function deviceRoutes(ctx) {
  const r = Router();
  r.get("/", async (req, res, next) => {
    try { res.json({ devices: (await ctx.sessions.list(req.user.id)).map((d) => ({ ...d, actual: Number(d.id) === req.device.id })) }); } catch (e) { next(e); }
  });
  // Crea un dispositivo (p. ej. el token del widget de Atajos). El token se muestra UNA sola vez.
  r.post("/", async (req, res, next) => {
    try {
      const kind = ["web", "shortcut", "pc"].includes(req.body?.kind) ? req.body.kind : "shortcut";
      const out = await ctx.sessions.create(req.user.id, { name: String(req.body?.name || "Atajo").slice(0, 60), kind });
      await ctx.audit.log({ userId: req.user.id, action: "dispositivo.creado", detail: `${kind} ${out.deviceId}` });
      res.status(201).json(out);
    } catch (e) { next(e); }
  });
  r.delete("/:id", async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const ok = await ctx.sessions.revoke(req.user.id, id);
      if (ok) { ctx.hub?.dropDevice(id); await ctx.audit.log({ userId: req.user.id, action: "dispositivo.revocado", detail: String(id) }); }
      res.status(ok ? 200 : 404).json({ ok });
    } catch (e) { next(e); }
  });
  return r;
}
