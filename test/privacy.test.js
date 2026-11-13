import { test } from "node:test";
import assert from "node:assert/strict";
import { memDb, spy } from "./helpers.js";
import { createQuota } from "../server/router/quota.js";
import { createRouter } from "../server/router/chain.js";
import { createPrivacy } from "../server/router/privacy.js";
import { createNotes } from "../server/memory/notes.js";
import { ProviderError } from "../server/providers/base.js";

const ALL = ["gemini", "groq", "mistral", "openrouter", "cloudflare", "ollama", "openai", "xai", "perplexity", "claude"];

async function setup({ groqFail = null, claudeOn = false } = {}) {
  const { db, userId } = await memDb();
  const providers = Object.fromEntries(ALL.map((id) => [id, spy(id)]));
  providers.groq.fail = groqFail;
  providers.claude.enabled = claudeOn;
  const router = createRouter({
    providers, chain: ["gemini", "groq", "mistral", "openrouter", "cloudflare", "ollama", "openai", "xai", "perplexity", "claude"],
    quota: createQuota({ db }), privacy: createPrivacy({ allowed: ["claude", "groq"] }),
  });
  return { router, providers, userId, db };
}
const calledIds = (ps) => Object.values(ps).filter((p) => p.calls > 0).map((p) => p.id);

test("mensaje privado solo llama a groq o claude", async () => {
  const { router, providers, userId } = await setup();
  const r = await router.route({ userId, kind: "privado", isPrivate: true, messages: [{ role: "user", content: "secreto" }] });
  assert.equal(r.ok, true);
  assert.equal(r.provider, "groq");
  assert.deepEqual(calledIds(providers), ["groq"]);
});

test("si groq falla y claude está apagado: sin_cuota y nadie más es llamado", async () => {
  const { router, providers, userId } = await setup({ groqFail: new ProviderError("caído", { status: 500 }) });
  const r = await router.route({ userId, kind: "privado", isPrivate: true, messages: [{ role: "user", content: "secreto" }] });
  assert.equal(r.ok, false);
  assert.equal(r.status, "sin_cuota");
  for (const id of ["gemini", "mistral", "openrouter", "cloudflare", "ollama", "openai", "xai", "perplexity"]) assert.equal(providers[id].calls, 0, id);
});

test("si groq falla y claude está encendido, lo privado va a claude", async () => {
  const { router, providers, userId } = await setup({ groqFail: new ProviderError("429", { status: 429 }), claudeOn: true });
  const r = await router.route({ userId, isPrivate: true, messages: [{ role: "user", content: "x" }] });
  assert.equal(r.provider, "claude");
  assert.deepEqual(calledIds(providers).sort(), ["claude", "groq"]);
});

test("lo no privado sí puede usar toda la cadena", async () => {
  const { router, userId } = await setup();
  const r = await router.route({ userId, isPrivate: false, kind: "razonamiento", messages: [{ role: "user", content: "x" }] });
  assert.equal(r.ok, true);
});

test("privacy.assert lanza si algo se salta el filtro", () => {
  const p = createPrivacy();
  assert.throws(() => p.assert("gemini", true));
  assert.doesNotThrow(() => p.assert("groq", true));
});

test("un mensaje es privado si el usuario lo marca o usa una nota privada", async () => {
  const { db, userId } = await memDb();
  const p = createPrivacy();
  assert.equal(p.isPrivateMessage({ flag: true }), true);
  assert.equal(p.isPrivateMessage({ notes: [{ level: "normal" }] }), false);
  assert.equal(p.isPrivateMessage({ notes: [{ level: "normal" }, { level: "privada" }] }), true);
  const notes = createNotes({ db });
  await notes.add({ userId, body: "mi pin", level: "privada" });
  assert.equal((await notes.counts(userId)).privadas, 1);
});
