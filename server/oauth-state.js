// Estados OAuth de un solo uso (anti-CSRF + guarda el verificador PKCE). Viven 10 minutos en `settings`.
import { randomBytes } from "node:crypto";
import { get, run } from "./db/client.js";

const TTL = 10 * 60_000;

export function createOAuthStates({ db, now = () => Date.now() }) {
  return {
    async create(userId, data) {
      const state = randomBytes(24).toString("base64url");
      await run(db, "INSERT INTO settings (user_id, key, value, created_at) VALUES (?,?,?,?)", [userId, `oauth:${state}`, JSON.stringify({ ...data, exp: now() + TTL }), now()]);
      return state;
    },
    // Devuelve { userId, ...data } y borra el estado; null si no existe o caducó.
    async take(state) {
      if (!state) return null;
      const r = await get(db, "SELECT user_id, value FROM settings WHERE key=?", [`oauth:${String(state)}`]);
      if (!r) return null;
      await run(db, "DELETE FROM settings WHERE key=?", [`oauth:${String(state)}`]);
      const d = JSON.parse(r.value);
      return d.exp > now() ? { userId: Number(r.user_id), ...d } : null;
    },
  };
}
