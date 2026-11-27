// Sesiones por dispositivo: token Bearer aleatorio; en la BD solo se guarda su hash.
import { createHash, randomBytes } from "node:crypto";
import { all, get, run } from "../db/client.js";

export const hashToken = (t) => createHash("sha256").update(String(t)).digest("hex");

// Sesiones web caducan a los 90 días sin uso (se renuevan al usarlas). pc/phone/shortcut no caducan; se revocan.
export const WEB_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// Caché en memoria de sesiones VÁLIDAS (los rechazos nunca se guardan). Revocar o cerrar sesión la vacía al instante.
// Un cambio hecho por fuera de este proceso (SQL a mano, otra instancia) tarda como mucho CACHE_MS en notarse.
export const CACHE_MS = 60_000;
export const TOUCH_MS = 5 * 60_000; // last_seen / renovación: como mucho una escritura cada 5 min por dispositivo

export function createSessions({ db, now = () => Date.now() }) {
  const cache = new Map(); // hash del token -> { user, device, expires, until }
  let generacion = 0; // una verificación empezada antes de revocar no puede volver a llenar la caché
  const invalidate = () => { generacion++; cache.clear(); };
  const copia = (e) => ({ user: { ...e.user }, device: { ...e.device } });
  async function revocar(sql, args) {
    invalidate();
    try { return (await run(db, sql, args)).changes > 0; } finally { invalidate(); }
  }
  return {
    invalidate, // llamar tras cambiar la clave o tocar devices/users por otra vía
    async create(userId, { name = "Dispositivo", kind = "web" } = {}) {
      const token = randomBytes(32).toString("base64url");
      const r = await run(db, "INSERT INTO devices (user_id, name, kind, token_hash, last_seen, created_at, expires_at) VALUES (?,?,?,?,?,?,?)",
        [userId, name, kind, hashToken(token), now(), now(), kind === "web" ? now() + WEB_TTL_MS : null]);
      return { token, deviceId: r.id };
    },
    // Devuelve { user, device } o null si el token no existe o fue revocado.
    async verify(token) {
      if (!token) return null;
      const hash = hashToken(token), t = now();
      const hit = cache.get(hash);
      if (hit && t < hit.until && !(hit.expires && hit.expires <= t)) return copia(hit);
      cache.delete(hash);
      const gen = generacion;
      const d = await get(db, `SELECT d.id, d.name, d.kind, d.revoked_at, d.expires_at, d.last_seen, u.id AS uid, u.name AS uname, u.role AS urole
        FROM devices d JOIN users u ON u.id = d.user_id WHERE d.token_hash = ?`, [hash]);
      if (!d || d.revoked_at) return null;
      let expires = d.expires_at ? Number(d.expires_at) : null;
      if (expires && expires <= t) return null; // caducó
      if (t - Number(d.last_seen || 0) >= TOUCH_MS) { // renovación por uso, sin esperarla
        if (expires) expires = t + WEB_TTL_MS;
        run(db, "UPDATE devices SET last_seen = ?, expires_at = CASE WHEN expires_at IS NULL THEN NULL ELSE ? END WHERE id = ? AND revoked_at IS NULL", [t, t + WEB_TTL_MS, d.id])
          .catch((e) => console.error("[sesion]", e?.message));
      }
      const entry = { user: { id: d.uid, name: d.uname, role: d.urole }, device: { id: Number(d.id), name: d.name, kind: d.kind }, expires, until: t + CACHE_MS };
      if (gen === generacion) cache.set(hash, entry);
      return copia(entry);
    },
    async list(userId) {
      return all(db, "SELECT id, name, kind, revoked_at, last_seen, created_at, expires_at FROM devices WHERE user_id = ? ORDER BY id", [userId]);
    },
    async revoke(userId, deviceId) {
      return revocar("UPDATE devices SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL", [now(), deviceId, userId]);
    },
    async revokeByToken(token) {
      return revocar("UPDATE devices SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL", [now(), hashToken(token)]);
    },
  };
}
