// Middleware: exige "Authorization: Bearer <token>" (nunca en la URL). Respaldo: cookie HttpOnly jarvis_sid.
export const COOKIE = "jarvis_sid";
const UN_ANO_S = 365 * 24 * 60 * 60;

export function bearer(req) {
  const h = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

// Cookie a mano (sin dependencias). Acepta el texto de la cabecera Cookie.
export function cookieValue(header, name = COOKIE) {
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()) || null; } catch { return null; }
    }
  }
  return null;
}
export const cookieToken = (req) => cookieValue(req.headers?.cookie);

const esHttps = (req) => !!req.secure || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase() === "https";
export function sessionCookie(req, token) {
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${UN_ANO_S}; HttpOnly; SameSite=Strict${esHttps(req) ? "; Secure" : ""}`;
}
export function clearCookie(req) {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${esHttps(req) ? "; Secure" : ""}`;
}

// Token de la petición: cabecera Authorization si existe; si no, la cookie (viaCookie=true).
export function requestToken(req) {
  const b = bearer(req);
  if (b) return { token: b, viaCookie: false };
  const c = cookieToken(req);
  return c ? { token: c, viaCookie: true } : { token: null, viaCookie: false };
}
export const tieneCabeceraCliente = (req) => String(req.headers["x-requested-with"] || "").toLowerCase() === "jarvis";
const SEGUROS = new Set(["GET", "HEAD", "OPTIONS"]);

// kinds: lista BLANCA de tipos de dispositivo permitidos (por defecto solo "web"). Los tokens de "pc", "shortcut" y "phone" solo sirven en sus rutas propias.
export function requireAuth(sessions, { kinds = ["web"] } = {}) {
  return async (req, res, next) => {
    try {
      const { token, viaCookie } = requestToken(req);
      // Solo cookie + método que cambia cosas: exige la cabecera propia (defensa extra a SameSite=Strict).
      if (viaCookie && !SEGUROS.has(req.method) && !tieneCabeceraCliente(req)) return res.status(403).json({ error: "falta_cabecera" });
      const s = await sessions.verify(token);
      if (!s) return res.status(401).json({ error: "no_autorizado" });
      const ok = kinds.includes(s.device.kind); // el token del PC solo sirve en /api/agent (no puede aprobarse a sí mismo)
      if (!ok) return res.status(403).json({ error: "dispositivo_no_permitido" });
      req.user = s.user; req.device = s.device; req.sessionToken = token;
      next();
    } catch (e) { next(e); }
  };
}
