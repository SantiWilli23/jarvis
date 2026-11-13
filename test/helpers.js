import { createDb } from "../server/db/client.js";
import { initSchema } from "../server/db/index.js";

// BD en memoria, esquema listo y un usuario dueño (id 1). Sin red ni claves.
export async function memDb() {
  const db = createDb({ url: ":memory:" });
  const { fts } = await initSchema(db);
  await db.execute({ sql: "INSERT INTO users (name, role, created_at) VALUES ('señor','dueno',?)", args: [Date.now()] });
  return { db, fts, userId: 1 };
}

export function clock(start = Date.UTC(2026, 0, 1, 12, 0, 0)) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

// Proveedor espía: cuenta llamadas y puede fallar a voluntad.
export function spy(id, { fail = null, text } = {}) {
  const p = {
    id, enabled: true, calls: 0, fail,
    async chat() {
      p.calls++;
      if (p.fail) throw p.fail;
      return { text: text ?? `respuesta de ${id}`, tokens: 5, headers: {} };
    },
  };
  return p;
}
