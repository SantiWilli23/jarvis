// Middleware: exige "Authorization: Bearer <token>" (nunca en la URL).
export function bearer(req) {
  const h = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

// kinds: lista BLANCA de tipos de dispositivo permitidos (por defecto solo "web"). Los tokens de "pc", "shortcut" y "phone" solo sirven en sus rutas propias.
export function requireAuth(sessions, { kinds = ["web"] } = {}) {
  return async (req, res, next) => {
    try {
      const s = await sessions.verify(bearer(req));
      if (!s) return res.status(401).json({ error: "no_autorizado" });
      const ok = kinds.includes(s.device.kind); // el token del PC solo sirve en /api/agent (no puede aprobarse a sí mismo)
      if (!ok) return res.status(403).json({ error: "dispositivo_no_permitido" });
      req.user = s.user; req.device = s.device;
      next();
    } catch (e) { next(e); }
  };
}
