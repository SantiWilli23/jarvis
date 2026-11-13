import { test } from "node:test";
import assert from "node:assert/strict";
import { memDb, clock, spy } from "./helpers.js";
import { createQuota, parseDuration } from "../server/router/quota.js";
import { createRouter } from "../server/router/chain.js";
import { createPrivacy } from "../server/router/privacy.js";
import { ProviderError } from "../server/providers/base.js";

const msgs = [{ role: "user", content: "hola" }];

async function setup(limits, providers, chain) {
  const { db, userId } = await memDb();
  const now = clock();
  const quota = createQuota({ db, limits, now });
  const router = createRouter({ providers, chain, quota, privacy: createPrivacy() });
  return { router, quota, now, userId };
}

test("salta al siguiente proveedor al agotar el minuto", async () => {
  const a = spy("gemini"), b = spy("groq");
  const { router, userId, now } = await setup({ gemini: { rpm: 2, rpd: null } }, { gemini: a, groq: b }, ["gemini", "groq"]);
  assert.equal((await router.route({ userId, messages: msgs })).provider, "gemini");
  assert.equal((await router.route({ userId, messages: msgs })).provider, "gemini");
  assert.equal((await router.route({ userId, messages: msgs })).provider, "groq");
  assert.equal(a.calls, 2);
  now.advance(61_000); // minuto nuevo: gemini vuelve
  assert.equal((await router.route({ userId, messages: msgs })).provider, "gemini");
});

test("salta al siguiente proveedor al agotar el día", async () => {
  const a = spy("gemini"), b = spy("groq");
  const { router, userId, now } = await setup({ gemini: { rpm: null, rpd: 1 } }, { gemini: a, groq: b }, ["gemini", "groq"]);
  await router.route({ userId, messages: msgs });
  now.advance(120_000);
  assert.equal((await router.route({ userId, messages: msgs })).provider, "groq");
  now.advance(24 * 3600_000);
  assert.equal((await router.route({ userId, messages: msgs })).provider, "gemini");
});

test("un 429 con cabecera de reinicio pausa al proveedor hasta esa hora", async () => {
  const a = spy("gemini", { fail: new ProviderError("limite", { status: 429, headers: { "retry-after": "120" } }) });
  const b = spy("groq");
  const { router, quota, userId, now } = await setup({}, { gemini: a, groq: b }, ["gemini", "groq"]);
  const t0 = now();
  const r1 = await router.route({ userId, messages: msgs });
  assert.equal(r1.provider, "groq");
  const q = await quota.check(userId, "gemini");
  assert.equal(q.ok, false);
  assert.equal(q.until, t0 + 120_000);
  await router.route({ userId, messages: msgs });
  assert.equal(a.calls, 1, "no vuelve a llamar mientras está pausado");
  now.advance(121_000);
  a.fail = null;
  assert.equal((await router.route({ userId, messages: msgs })).provider, "gemini");
});

test("cabecera de Groq con duración (2m59.56s) y remaining=0 pausa", async () => {
  assert.equal(parseDuration("2m59.56s"), 179_560);
  const { db, userId } = await memDb();
  const now = clock();
  const quota = createQuota({ db, now });
  await quota.ingestHeaders(userId, "groq", { "x-ratelimit-remaining-requests": "0", "x-ratelimit-reset-requests": "2m59.56s" });
  const q = await quota.check(userId, "groq");
  assert.equal(q.ok, false);
  assert.equal(q.until, now() + 179_560);
});

test("con todos agotados devuelve sin_cuota", async () => {
  const a = spy("gemini"), b = spy("groq", { fail: new ProviderError("x", { status: 429 }) });
  const { router, userId } = await setup({ gemini: { rpm: 0, rpd: null } }, { gemini: a, groq: b }, ["gemini", "groq"]);
  const r = await router.route({ userId, messages: msgs });
  assert.equal(r.ok, false);
  assert.equal(r.status, "sin_cuota");
  assert.equal(a.calls, 0);
});

test("proveedores apagados (sin clave) se saltan", async () => {
  const a = spy("gemini"); a.enabled = false;
  const b = spy("groq");
  const { router, userId } = await setup({}, { gemini: a, groq: b }, ["gemini", "groq"]);
  assert.equal((await router.route({ userId, messages: msgs })).provider, "groq");
  assert.equal(a.calls, 0);
});
