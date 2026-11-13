// Notas de memoria. Niveles: "normal" y "privada". El nivel "secreta" NUNCA se guarda:
// la función devuelve sin tocar la base de datos.
import { all, get, run } from "../db/client.js";

export const estimateTokens = (s) => Math.ceil(String(s || "").length / 4);
const NIVELES = new Set(["normal", "privada"]);

export function createNotes({ db, fts = false, now = () => Date.now() }) {
  async function indexNote(id, userId, title, body) {
    if (!fts) return;
    await run(db, "INSERT INTO notes_fts (rowid, title, body, note_id, user_id) VALUES (?,?,?,?,?)", [id, title, body, id, userId]);
  }
  async function unindex(id) {
    if (fts) await run(db, "DELETE FROM notes_fts WHERE rowid = ?", [id]);
  }
  return {
    fts,
    // source: "usuario" (activa al instante) | "modelo" (va a la zona de revisión, ver inbox.js)
    async add({ userId, title = "", body, level = "normal", source = "usuario", status }) {
      if (String(level).toLowerCase().startsWith("secret")) return { saved: false, reason: "secreta" };
      if (!NIVELES.has(level)) return { saved: false, reason: "nivel_invalido" };
      if (!body || !String(body).trim()) return { saved: false, reason: "vacia" };
      const st = status || (source === "modelo" ? "revision" : "activa");
      const r = await run(db, "INSERT INTO notes (user_id, title, body, level, source, status, tokens, created_at) VALUES (?,?,?,?,?,?,?,?)",
        [userId, title, body, level, source, st, estimateTokens(title + " " + body), now()]);
      if (st === "activa") await indexNote(r.id, userId, title, body);
      return { saved: true, id: r.id, status: st };
    },
    async setStatus(userId, id, status) {
      const n = await get(db, "SELECT * FROM notes WHERE id=? AND user_id=?", [id, userId]);
      if (!n) return false;
      await run(db, "UPDATE notes SET status=? WHERE id=?", [status, id]);
      await unindex(id);
      if (status === "activa") await indexNote(id, userId, n.title, n.body);
      return true;
    },
    async remove(userId, id) {
      await unindex(id);
      return (await run(db, "DELETE FROM notes WHERE id=? AND user_id=?", [id, userId])).changes > 0;
    },
    async list(userId, { status = "activa", limit = 100 } = {}) {
      return all(db, "SELECT id, title, body, level, source, status, tokens, created_at FROM notes WHERE user_id=? AND status=? ORDER BY id DESC LIMIT ?", [userId, status, limit]);
    },
    async counts(userId) {
      const r = await get(db, `SELECT
        SUM(CASE WHEN status='activa' THEN 1 ELSE 0 END) AS total,
        SUM(CASE WHEN status='activa' AND level='privada' THEN 1 ELSE 0 END) AS privadas,
        SUM(CASE WHEN status='revision' THEN 1 ELSE 0 END) AS revision
        FROM notes WHERE user_id=?`, [userId]);
      return { total: Number(r.total || 0), privadas: Number(r.privadas || 0), revision: Number(r.revision || 0) };
    },
  };
}
