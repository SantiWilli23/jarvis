// Inicialización idempotente del esquema y del usuario dueño.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { all, get, run } from "./client.js";
import { hashPassword, verifyPassword } from "../auth/password.js";

const SCHEMA = readFileSync(fileURLToPath(new URL("./schema.sql", import.meta.url)), "utf8");

// Migraciones idempotentes (SQLite y Turso): agrega la columna solo si falta.
async function addColumn(db, table, column, ddl) {
  const cols = await all(db, `PRAGMA table_info(${table})`);
  if (cols.some((c) => c.name === column)) return;
  try { await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`); }
  catch (e) { if (!/duplicate column/i.test(String(e?.message))) throw e; } // carrera entre instancias
}
export async function migrate(db) {
  await addColumn(db, "approvals", "pro_job_id", "INTEGER");
  await addColumn(db, "tasks", "engine", "TEXT NOT NULL DEFAULT 'claude'"); // motor del PC: claude | gemini
  await addColumn(db, "pro_jobs", "model_real", "TEXT"); // modelo que de verdad atendió el job (puede ser el de reserva)
  await addColumn(db, "pro_threads", "resumen", "TEXT"); // resumen del hilo que mantiene el coordinador (Groq)
  await addColumn(db, "pro_threads", "modo", "TEXT NOT NULL DEFAULT 'local'"); // local | web
  await addColumn(db, "pro_threads", "gh_repo", "TEXT");
  await addColumn(db, "pro_threads", "gh_rama", "TEXT");
  await addColumn(db, "browser_tasks", "pro_round_id", "INTEGER"); // tarea ligada a una ronda Pro web (solo preparar)
  await addColumn(db, "devices", "expires_at", "INTEGER"); // caducidad: solo sesiones web (90 días); pc/phone/shortcut = NULL
  await db.execute({ sql: "UPDATE devices SET expires_at = ? WHERE kind = 'web' AND expires_at IS NULL", args: [Date.now() + 90 * 24 * 60 * 60 * 1000] });
}

// Devuelve { fts: true|false }. Si FTS5 no está disponible, las búsquedas usan LIKE por palabras.
export async function initSchema(db) {
  await db.executeMultiple(SCHEMA);
  await migrate(db);
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
