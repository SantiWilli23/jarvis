// migrate: con el esquema al día mira las columnas en un viaje; si falta una, la añade.
import test from "node:test";
import assert from "node:assert/strict";
import { migrate } from "../server/db/index.js";
import { memDb } from "./helpers.js";

test("migrate al día usa una sola consulta de esquema y repone una columna que falta", async () => {
  const { db } = await memDb();
  const sqls = [];
  const espia = { execute: (q) => { sqls.push(typeof q === "string" ? q : q.sql); return db.execute(q); } };
  await migrate(espia);
  assert.equal(sqls.length, 2); // esquema + relleno de expires_at
  await db.execute("ALTER TABLE notes DROP COLUMN origen");
  sqls.length = 0;
  await migrate(espia);
  assert.deepEqual(sqls.filter((s) => s.startsWith("ALTER")), ["ALTER TABLE notes ADD COLUMN origen TEXT NOT NULL DEFAULT ''"]);
});
