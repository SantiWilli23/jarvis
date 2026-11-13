// Tabla `connections`: una fila por conector. Los tokens van cifrados en la columna `detail`.
import { all, get, run } from "./db/client.js";

export function createConnections({ db, crypto, now = () => Date.now() }) {
  return {
    async save(userId, name, data) {
      const blob = crypto.encrypt(data);
      const cur = await get(db, "SELECT id FROM connections WHERE user_id=? AND name=?", [userId, name]);
      if (cur) await run(db, "UPDATE connections SET ok=1, detail=? WHERE id=?", [blob, cur.id]);
      else await run(db, "INSERT INTO connections (user_id, name, ok, detail, created_at) VALUES (?,?,1,?,?)", [userId, name, blob, now()]);
    },
    async load(userId, name) {
      const r = await get(db, "SELECT detail, ok FROM connections WHERE user_id=? AND name=?", [userId, name]);
      if (!r || !r.ok || !r.detail || !crypto.enabled) return null;
      try { return crypto.decrypt(r.detail); } catch { return null; }
    },
    async connected(userId, name) {
      const r = await get(db, "SELECT ok FROM connections WHERE user_id=? AND name=?", [userId, name]);
      return !!r?.ok && crypto.enabled;
    },
    async remove(userId, name) {
      return (await run(db, "DELETE FROM connections WHERE user_id=? AND name=?", [userId, name])).changes > 0;
    },
    async list(userId) { return all(db, "SELECT name, ok, created_at FROM connections WHERE user_id=?", [userId]); },
  };
}
