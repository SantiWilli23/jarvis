// Sesiones por dispositivo: token Bearer aleatorio; en la BD solo se guarda su hash.
import { createHash, randomBytes } from "node:crypto";
import { all, get, run } from "../db/client.js";

export const hashToken = (t) => createHash("sha256").update(String(t)).digest("hex");

// Sesiones web caducan a los 90 días sin uso (se renuevan al usarlas). pc/phone/shortcut no caducan; se revocan.
export const WEB_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export function createSessions({ db, now = () => Date.now() }) {
  return {
    async create(userId, { name = "Dispositivo", kind = "web" } = {}) {
      const token = randomBytes(32).toString("base64url");
      const r = await run(db, "INSERT INTO devices (user_id, name, kind, token_hash, last_seen, created_at, expires_at) VALUES (?,?,?,?,?,?,?)",
        [userId, name, kind, hashToken(token), now(), now(), kind === "web" ? now() + WEB_TTL_MS : null]);
      return { token, deviceId: r.id };
    },
    // Devuelve { user, device } o null si el token no existe o fue revocado.
    async verify(token) {
      if (!token) return null;
      const d = await get(db, "SELECT * FROM devices WHERE token_hash = ?", [hashToken(token)]);
      if (!d || d.revoked_at) return null;
      if (d.expires_at && Number(d.expires_at) <= now()) return null; // caducó
      const user = await get(db, "SELECT id, name, role FROM users WHERE id = ?", [d.user_id]);
      if (!user) return null;
      await run(db, "UPDATE devices SET last_seen = ?, expires_at = CASE WHEN expires_at IS NULL THEN NULL ELSE ? END WHERE id = ?", [now(), now() + WEB_TTL_MS, d.id]); // renovación por uso (solo si ya caducaba)
      return { user, device: { id: Number(d.id), name: d.name, kind: d.kind } };
    },
    async list(userId) {
      return all(db, "SELECT id, name, kind, revoked_at, last_seen, created_at, expires_at FROM devices WHERE user_id = ? ORDER BY id", [userId]);
    },
    async revoke(userId, deviceId) {
      const r = await run(db, "UPDATE devices SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL", [now(), deviceId, userId]);
      return r.changes > 0;
    },
    async revokeByToken(token) {
      const r = await run(db, "UPDATE devices SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL", [now(), hashToken(token)]);
      return r.changes > 0;
    },
  };
}
