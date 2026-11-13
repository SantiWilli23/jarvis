// Búsqueda en la memoria: devuelve como máximo k notas y no pasa del presupuesto de tokens.
// Usa FTS5 si está disponible; si no, cae a LIKE por palabras.
import { all } from "../db/client.js";

const STOP = new Set(["el", "la", "los", "las", "un", "una", "de", "del", "que", "y", "en", "a", "por", "para", "con", "es", "mi", "me", "se", "lo", "al", "su"]);

export function words(q) {
  return [...new Set(String(q || "").toLowerCase().normalize("NFC").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !STOP.has(w)))].slice(0, 12);
}

export function createSearch({ db, fts = false }) {
  return {
    async search({ userId, query, k = 5, tokenBudget = 800, includePrivate = true }) {
      const ws = words(query);
      if (!ws.length || k <= 0) return { notes: [], tokens: 0 };
      const lvl = includePrivate ? "" : "AND n.level = 'normal'";
      let rows;
      if (fts) {
        const match = ws.map((w) => `"${w.replace(/"/g, "")}"*`).join(" OR ");
        try {
          rows = await all(db, `SELECT n.id, n.title, n.body, n.level, n.tokens FROM notes_fts f JOIN notes n ON n.id = f.rowid
            WHERE notes_fts MATCH ? AND n.user_id = ? AND n.status = 'activa' ${lvl} ORDER BY bm25(notes_fts) LIMIT ?`, [match, userId, k * 4]);
        } catch { rows = null; }
      }
      if (!rows) {
        const cond = ws.map(() => "(LOWER(n.title) LIKE ? OR LOWER(n.body) LIKE ?)").join(" OR ");
        const args = ws.flatMap((w) => [`%${w}%`, `%${w}%`]);
        rows = await all(db, `SELECT n.id, n.title, n.body, n.level, n.tokens FROM notes n
          WHERE n.user_id = ? AND n.status = 'activa' ${lvl} AND (${cond}) ORDER BY n.id DESC LIMIT ?`, [userId, ...args, k * 4]);
      }
      const out = []; let tokens = 0;
      for (const r of rows) {
        if (out.length >= k) break;
        const t = Number(r.tokens);
        if (tokens + t > tokenBudget) continue;
        out.push({ id: Number(r.id), title: r.title, body: r.body, level: r.level, tokens: t });
        tokens += t;
      }
      return { notes: out, tokens };
    },
  };
}
