// Inicialización idempotente del esquema y del usuario dueño.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { all, get, run } from "./client.js";
import { hashPassword, verifyPassword } from "../auth/password.js";

const SCHEMA = readFileSync(fileURLToPath(new URL("./schema.sql", import.meta.url)), "utf8");

// Columnas actuales de las tablas pedidas, en un solo viaje: Set de "tabla.columna".
// Si el servidor no admite pragma_table_info como tabla, se pregunta tabla por tabla (en paralelo).
async function columnas(db, tablas) {
  try {
    const rows = await all(db, `SELECT m.name AS t, p.name AS c FROM sqlite_master m JOIN pragma_table_info(m.name) p
      WHERE m.type = 'table' AND m.name IN (${tablas.map(() => "?").join(",")})`, tablas);
    return new Set(rows.map((r) => `${r.t}.${r.c}`));
  } catch {
    const porTabla = await Promise.all(tablas.map(async (t) => (await all(db, `PRAGMA table_info(${t})`)).map((c) => `${t}.${c.name}`)));
    return new Set(porTabla.flat());
  }
}
// Migraciones idempotentes (SQLite y Turso): agrega la columna solo si falta.
export async function migrate(db) {
  const nuevas = [];
  const addColumn = (table, column, ddl) => nuevas.push([table, column, ddl]);
  addColumn("approvals", "pro_job_id", "INTEGER");
  addColumn("notes", "origen", "TEXT NOT NULL DEFAULT ''"); // de qué IA vino (docs/MEMORIA.md)
  addColumn("tasks", "engine", "TEXT NOT NULL DEFAULT 'claude'"); // motor del PC: claude | gemini
  addColumn("pro_jobs", "model_real", "TEXT"); // modelo que de verdad atendió el job (puede ser el de reserva)
  addColumn("pro_threads", "resumen", "TEXT"); // resumen del hilo que mantiene el coordinador (Groq)
  addColumn("pro_threads", "modo", "TEXT NOT NULL DEFAULT 'local'"); // local | web
  addColumn("pro_threads", "gh_repo", "TEXT");
  addColumn("pro_threads", "gh_rama", "TEXT");
  addColumn("browser_tasks", "pro_round_id", "INTEGER"); // tarea ligada a una ronda Pro web (solo preparar)
  for (const t of ["pc_actions", "phone_actions"]) { // a quién devolver el resultado (chat, dispositivo y origen de la orden)
    addColumn(t, "conversation_id", "INTEGER");
    addColumn(t, "device_id", "INTEGER");
    addColumn(t, "source", "TEXT");
  }
  // Navegador de Claude v2 (docs/NAV.md): perfiles, en vivo e historial.
  for (const [col, ddl] of [["perfil", "TEXT"], ["url_conversacion", "TEXT"], ["session_id", "TEXT"], ["pasos", "TEXT"], ["cuenta_visible", "TEXT"],
    ["capturas", "INTEGER NOT NULL DEFAULT 0"], ["url_inicial", "TEXT"], ["cuenta", "TEXT"]]) addColumn("nav_tasks", col, ddl);
  // Registro de uso del PC (capturas): solo fecha, tipo, dispositivo y ok (1/0, NULL = en curso). Nunca imagen ni descripción.
  for (const [col, ddl] of [["tipo", "TEXT"], ["device_id", "INTEGER"], ["ok", "INTEGER"], ["action_id", "INTEGER"]]) addColumn("claude_usage", col, ddl);
  addColumn("memoria_repartos", "nav_id", "INTEGER"); // tarea del navegador que lo atiende
  addColumn("devices", "expires_at", "INTEGER"); // caducidad: solo sesiones web (90 días); pc/phone/shortcut = NULL
  const hay = await columnas(db, [...new Set(nuevas.map(([t]) => t))]);
  for (const [table, column, ddl] of nuevas) {
    if (hay.has(`${table}.${column}`)) continue;
    try { await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`); }
    catch (e) { if (!/duplicate column/i.test(String(e?.message))) throw e; } // carrera entre instancias
  }
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
