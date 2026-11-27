// snapshot agrupado, anotación sin espera, y charla rápida (reasoning_effort + tope de tiempo).
import test from "node:test";
import assert from "node:assert/strict";
import { createQuota } from "../server/router/quota.js";
import { createRouter } from "../server/router/chain.js";
import { createPrivacy } from "../server/router/privacy.js";
import { GroqProvider } from "../server/providers/groq.js";
import { memDb, clock, spy } from "./helpers.js";

test("snapshot: mismos valores que antes, con una sola consulta", async () => {
  const { db, userId } = await memDb(), now = clock();
  let n = 0;
  const q = createQuota({ db: { execute: (x) => { n++; return db.execute(x); } }, limits: { groq: { rpm: 30, rpd: 1000 } }, now });
  await q.record(userId, "groq", 5);
  now.advance(60_000);
  await q.record(userId, "groq", 5);
  await q.record(userId, "gemini", 1);
  await q.pause(userId, "mistral", 12345, "x");
  await q.record(userId + 1, "groq", 1); // otro usuario: no cuenta
  n = 0;
  assert.deepEqual(await q.snapshot(userId, ["groq", "gemini", "mistral", "openai"]), {
    groq: { used_min: 1, used_day: 2, limit_min: 30, limit_day: 1000, paused_until: null },
    gemini: { used_min: 1, used_day: 1, limit_min: null, limit_day: null, paused_until: null },
    mistral: { used_min: 0, used_day: 0, limit_min: null, limit_day: null, paused_until: 12345 },
    openai: { used_min: 0, used_day: 0, limit_min: null, limit_day: null, paused_until: null },
  });
  assert.equal(n, 1);
});

test("anotar no se espera, pero check ya lo ve; las cabeceras no borran el último error", async () => {
  const { db, userId } = await memDb();
  const q = createQuota({ db, limits: { groq: { rpm: 1 } }, now: clock() });
  await q.pause(userId, "groq", 0, "fallo viejo");
  q.anotar(userId, "groq", 3, { "x-algo": "1" });
  assert.equal((await q.check(userId, "groq")).reason, "minuto");
  const r = await db.execute("SELECT last_error, headers_json FROM provider_state");
  assert.equal(r.rows[0].last_error, "fallo viejo");
  assert.match(r.rows[0].headers_json, /x-algo/);
});

test("Groq: reasoning_effort low solo en charla", async () => {
  const cuerpos = [];
  const p = new GroqProvider({ apiKey: "k", fetch: async (_u, o) => { cuerpos.push(JSON.parse(o.body)); return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] })); } });
  await p.chat({ messages: [], kind: "charla" });
  await p.chat({ messages: [], kind: "razonamiento" });
  await p.chat({ messages: [], kind: "privado" });
  assert.deepEqual(cuerpos.map((c) => c.reasoning_effort), ["low", undefined, undefined]);
});

test("en charla un proveedor colgado cede al siguiente; fuera de la charla no se corta", async () => {
  const { db, userId } = await memDb();
  const lento = { id: "lento", enabled: true, chat: ({ signal }) => new Promise((ok, mal) => {
    const t = setTimeout(() => ok({ text: "tarde", tokens: 1, headers: {} }), 150);
    signal?.addEventListener("abort", () => { clearTimeout(t); mal(new Error("abortado")); });
  }) };
  const router = createRouter({ providers: { lento, otro: spy("otro") }, chain: ["lento", "otro"], quota: createQuota({ db }), privacy: createPrivacy({ allowed: ["lento"] }), timeoutCharlaMs: 20 });
  assert.equal((await router.route({ userId, kind: "razonamiento", messages: [] })).provider, "lento");
  assert.equal((await router.route({ userId, kind: "charla", messages: [] })).provider, "otro");
  // Lo privado no se degrada a un proveedor fuera de la lista.
  const r = await router.route({ userId, kind: "charla", isPrivate: true, messages: [] });
  assert.equal(r.ok, false);
});
