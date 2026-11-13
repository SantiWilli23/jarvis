// Límite de intentos de inicio de sesión: 5 fallos seguidos bloquean 15 minutos.
import { get, run } from "../db/client.js";

export function createLoginLimiter({ db, now = () => Date.now(), max = 5, lockMs = 15 * 60 * 1000 }) {
  // Cuenta fallos desde el último acierto, dentro de la ventana.
  async function failures(key) {
    const lastOk = await get(db, "SELECT MAX(created_at) AS t FROM login_attempts WHERE key = ? AND ok = 1", [key]);
    const since = Math.max(now() - lockMs, lastOk?.t ? Number(lastOk.t) : 0);
    const r = await get(db, "SELECT COUNT(*) AS n, MAX(created_at) AS last FROM login_attempts WHERE key = ? AND ok = 0 AND created_at > ?", [key, since]);
    return { n: Number(r.n), last: Number(r.last || 0) };
  }
  return {
    // { locked, retryAfterMs }
    async check(keys) {
      let worst = 0;
      for (const key of [].concat(keys)) {
        const f = await failures(key);
        if (f.n >= max) worst = Math.max(worst, f.last + lockMs - now());
      }
      return worst > 0 ? { locked: true, retryAfterMs: worst } : { locked: false, retryAfterMs: 0 };
    },
    async record(keys, ok, userId = null) {
      for (const key of [].concat(keys)) {
        await run(db, "INSERT INTO login_attempts (user_id, key, ok, created_at) VALUES (?,?,?,?)", [userId, key, ok ? 1 : 0, now()]);
      }
    },
  };
}
