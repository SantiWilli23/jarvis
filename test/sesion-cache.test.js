// Caché de sesión: revocar y cerrar sesión se notan al instante; los rechazos no se guardan.
import test from "node:test";
import assert from "node:assert/strict";
import { createSessions, CACHE_MS, TOUCH_MS, WEB_TTL_MS } from "../server/auth/sessions.js";
import { get } from "../server/db/client.js";
import { memDb, clock } from "./helpers.js";

// Cuenta los viajes a la BD.
function contado(db) {
  const c = { n: 0 };
  return { c, db: { execute: (q) => { c.n++; return db.execute(q); } } };
}

test("la segunda verificación no toca la BD y la caché vence a los 60 s", async () => {
  const base = await memDb(), now = clock();
  const { c, db } = contado(base.db);
  const s = createSessions({ db, now });
  const { token } = await s.create(base.userId, { name: "a" });
  assert.ok(await s.verify(token));
  const n = c.n;
  assert.equal((await s.verify(token)).device.name, "a");
  assert.equal(c.n, n);
  await base.db.execute("UPDATE devices SET revoked_at = 1"); // por fuera: se nota al vencer
  now.advance(CACHE_MS);
  assert.equal(await s.verify(token), null);
});

test("revoke y revokeByToken invalidan la caché al instante", async () => {
  const { db, userId } = await memDb();
  const s = createSessions({ db });
  const a = await s.create(userId), b = await s.create(userId);
  assert.ok(await s.verify(a.token));
  assert.ok(await s.verify(b.token));
  await s.revoke(userId, a.deviceId);
  assert.equal(await s.verify(a.token), null);
  await s.revokeByToken(b.token);
  assert.equal(await s.verify(b.token), null);
});

test("una verificación en vuelo no vuelve a cachear una sesión revocada", async () => {
  const base = await memDb();
  let soltar, pausar = false;
  const db = { async execute(q) {
    const r = await base.db.execute(q);
    if (pausar && /FROM devices d JOIN users/.test(q.sql)) { pausar = false; await new Promise((ok) => { soltar = ok; }); }
    return r;
  } };
  const s = createSessions({ db });
  const { token, deviceId } = await s.create(base.userId);
  pausar = true;
  const vuelo = s.verify(token);
  while (!soltar) await new Promise((ok) => setImmediate(ok));
  await s.revoke(base.userId, deviceId);
  soltar();
  await vuelo;
  assert.equal(await s.verify(token), null);
});

test("la caducidad se respeta aunque esté en caché; last_seen se escribe como mucho cada 5 min", async () => {
  const { db, userId } = await memDb(), now = clock();
  const s = createSessions({ db, now });
  const { token, deviceId } = await s.create(userId);
  const fila = () => get(db, "SELECT last_seen, expires_at FROM devices WHERE id=?", [deviceId]);
  const t0 = now();
  now.advance(TOUCH_MS - 1);
  await s.verify(token);
  assert.equal(Number((await fila()).last_seen), t0);
  now.advance(CACHE_MS);
  await s.verify(token);
  assert.equal(Number((await fila()).last_seen), now());
  assert.equal(Number((await fila()).expires_at), now() + WEB_TTL_MS);
  await db.execute({ sql: "UPDATE devices SET expires_at=?, last_seen=? WHERE id=?", args: [now() + CACHE_MS + 10, now() + CACHE_MS, deviceId] });
  now.advance(CACHE_MS);
  assert.ok(await s.verify(token));
  now.advance(11);
  assert.equal(await s.verify(token), null);
});
