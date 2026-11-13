// Cliente de base de datos (libsql). Sin DATABASE_URL usa un archivo local.
import { createClient } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function createDb({ url, authToken } = {}) {
  let u = url;
  if (!u) {
    const file = resolve(process.cwd(), "data", "jarvis.db");
    mkdirSync(dirname(file), { recursive: true });
    u = pathToFileURL(file).href;
  }
  return createClient({ url: u, authToken: authToken || undefined });
}

// Ayudas pequeñas: devuelven filas como objetos simples.
export async function all(db, sql, args = []) {
  const r = await db.execute({ sql, args });
  return r.rows.map((row) => ({ ...row }));
}
export async function get(db, sql, args = []) {
  return (await all(db, sql, args))[0] || null;
}
export async function run(db, sql, args = []) {
  const r = await db.execute({ sql, args });
  return { changes: r.rowsAffected, id: r.lastInsertRowid == null ? null : Number(r.lastInsertRowid) };
}
