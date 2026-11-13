import { test } from "node:test";
import assert from "node:assert/strict";
import { memDb, clock } from "./helpers.js";
import { hashPassword, verifyPassword } from "../server/auth/password.js";
import { createSessions } from "../server/auth/sessions.js";
import { createLoginLimiter } from "../server/auth/ratelimit.js";

test("scrypt: acepta la correcta y rechaza otras", async () => {
  const h = await hashPassword("clave-de-prueba");
  assert.match(h, /^scrypt\$/);
  assert.equal(await verifyPassword("clave-de-prueba", h), true);
  assert.equal(await verifyPassword("otra", h), false);
});

test("bloqueo tras 5 fallos durante 15 minutos", async () => {
  const { db } = await memDb();
  const now = clock();
  const lim = createLoginLimiter({ db, now });
  const keys = ["u:owner", "ip:1.2.3.4"];
  for (let i = 0; i < 4; i++) { await lim.record(keys, false); assert.equal((await lim.check(keys)).locked, false); }
  await lim.record(keys, false);
  const l = await lim.check(keys);
  assert.equal(l.locked, true);
  assert.equal(l.retryAfterMs, 15 * 60 * 1000);
  now.advance(14 * 60 * 1000);
  assert.equal((await lim.check(keys)).locked, true);
  now.advance(61 * 1000);
  assert.equal((await lim.check(keys)).locked, false);
});

test("un acierto reinicia la cuenta de fallos", async () => {
  const { db } = await memDb();
  const lim = createLoginLimiter({ db, now: clock() });
  for (let i = 0; i < 4; i++) await lim.record("k", false);
  await lim.record("k", true);
  for (let i = 0; i < 4; i++) await lim.record("k", false);
  assert.equal((await lim.check("k")).locked, false);
});

test("token revocado se rechaza; en la BD solo está el hash", async () => {
  const { db, userId } = await memDb();
  const s = createSessions({ db });
  const { token, deviceId } = await s.create(userId, { name: "iPhone" });
  assert.equal((await s.verify(token)).user.id, userId);
  const rows = (await db.execute("SELECT token_hash FROM devices")).rows;
  assert.notEqual(rows[0].token_hash, token);
  assert.equal(await s.revoke(userId, deviceId), true);
  assert.equal(await s.verify(token), null);
  assert.equal(await s.verify("inventado"), null);
  assert.equal(await s.verify(null), null);
});
