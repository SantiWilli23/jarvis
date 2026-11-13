// Inicialización idempotente del esquema y del usuario dueño.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { all, get, run } from "./client.js";
import { hashPassword, verifyPassword } from "../auth/password.js";

const SCHEMA = readFileSync(fileURLToPath(new URL("./schema.sql", import.meta.url)), "utf8");

// Devuelve { fts: true|false }. Si FTS5 no está disponible, las búsquedas usan LIKE por palabras.
export async function initSchema(db) {
  await db.executeMultiple(SCHEMA);
  let fts = false;
  try {
    await db.execute("CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(title, body, note_id UNINDEXED, user_id UNINDEXED)");
    fts = true;
  } catch { fts = false; }
  return { fts };
}

// Crea el usuario dueño si no existe. Devuelve su id.
export async function ensureOwner(db, { name = "señor", password } = {}) {
  const existing = await get(db, "SELECT id, password_hash FROM users WHERE role = 'dueno' ORDER BY id LIMIT 1");
  if (existing) {
    if (password && !(existing.password_hash && await verifyPassword(password, existing.password_hash))) {
      await run(db, "UPDATE users SET password_hash = ? WHERE id = ?", [await hashPassword(password), existing.id]);
    }
    return Number(existing.id);
  }
  const r = await run(db, "INSERT INTO users (name, role, password_hash, created_at) VALUES (?, 'dueno', ?, ?)",
    [name, password ? await hashPassword(password) : null, Date.now()]);
  return r.id;
}

export { all };
