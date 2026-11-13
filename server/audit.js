// Registro de auditoría: qué se hizo y cuándo. Nunca guarda contraseñas ni tokens.
import { all, run } from "./db/client.js";

export function createAudit({ db, now = () => Date.now() }) {
  return {
    async log({ userId = null, action, detail = "" }) {
      await run(db, "INSERT INTO audit_log (user_id, action, detail, created_at) VALUES (?,?,?,?)", [userId, action, String(detail).slice(0, 500), now()]);
    },
    async list(userId, limit = 100) {
      return all(db, "SELECT id, action, detail, created_at FROM audit_log WHERE user_id = ? OR user_id IS NULL ORDER BY id DESC LIMIT ?", [userId, limit]);
    },
  };
}
