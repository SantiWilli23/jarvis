// Charla en vivo (docs/CONVERSA.md). Sin red: Google se simula.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createConversa, FIELD_MASK } from "../server/conversa.js";
import { buildContext } from "../server/context.js";
import { createApp, csp } from "../server/app.js";
import { all, get } from "../server/db/client.js";
import { memDb, clock } from "./helpers.js";

const web = (f) => readFileSync(new URL(`../web/${f}`, import.meta.url), "utf8");
const bien = (llamadas) => async (url, o) => { llamadas.push({ url, ...o }); return { ok: true, status: 200, json: async () => ({ name: "auth_tokens/secreto" }) }; };
const CFG = { enabled: true, tope_minutos_dia: 20, max_min_sesion: 15 };

async function armar({ config = CFG, fetch, frenado = false } = {}) {
  const { db } = await memDb();
  const now = clock(), llamadas = [], registro = [];
  const conversa = createConversa({ db, env: { GEMINI_API_KEY: "clave-real" }, fetch: fetch ?? bien(llamadas), config, persona: "Eres Jarvis.", control: { frenado: async () => frenado }, audit: { log: async (x) => registro.push(x) }, now });
  const usado = async () => Number((await get(db, "SELECT tokens FROM provider_usage WHERE provider='live'"))?.tokens ?? 0);
  return { db, now, llamadas, registro, conversa, usado };
}

test("el token fija el setup sin herramientas y no filtra la clave ni el token", async () => {
  const s = await armar();
  const r = await s.conversa.token(1);
  assert.equal(r.token, "auth_tokens/secreto");
  assert.equal(r.segundos, 900);
  assert.ok(new RegExp(r.privado.source, r.privado.flags).test("mi contraseña"));
  const cuerpo = JSON.parse(s.llamadas[0].body);
  assert.equal(cuerpo.uses, 1);
  assert.equal(Date.parse(cuerpo.expireTime) - s.now(), 900_000);
  assert.equal(cuerpo.fieldMask, FIELD_MASK);
  for (const campo of ["tools", "systemInstruction", "model"]) assert.ok(FIELD_MASK.split(",").includes(campo), campo);
  assert.ok(!FIELD_MASK.includes("sessionResumption"));
  assert.equal(cuerpo.bidiGenerateContentSetup.tools, undefined);
  assert.equal(cuerpo.bidiGenerateContentSetup.model, "models/gemini-3.8-live");
  assert.match(cuerpo.bidiGenerateContentSetup.systemInstruction.parts[0].text, /Eres Jarvis\.[\s\S]*CHARLA EN VIVO/);
  assert.ok(!JSON.stringify(r).includes("clave-real"));
  assert.ok(!JSON.stringify(s.registro).includes("secreto"));
});

test("el tope diario se cumple aunque nunca se llame a /fin, también con pedidos a la vez", async () => {
  const s = await armar();
  const res = await Promise.allSettled([1, 2, 3, 4].map(() => s.conversa.token(1)));
  const dados = res.filter((x) => x.status === "fulfilled").reduce((n, x) => n + x.value.segundos, 0);
  assert.equal(dados, 1200);
  assert.equal(await s.usado(), 1200);
  await assert.rejects(s.conversa.token(1), (e) => e.error === "tope_dia" && e.status === 429);
});

test("/fin devuelve lo no usado una sola vez, medido por el servidor", async () => {
  const s = await armar();
  const { id } = await s.conversa.token(1);
  s.now.advance(100_000);
  assert.equal((await s.conversa.fin(1, { id })).segundos, 100);
  assert.equal(await s.usado(), 100);
  await assert.rejects(s.conversa.fin(1, { id }), (e) => e.status === 404);
  assert.equal(await s.usado(), 100);
});

test("guarda la charla como no privada; si hubo algo privado no guarda nada", async () => {
  const s = await armar();
  const a = await s.conversa.token(1);
  const r = await s.conversa.fin(1, { id: a.id, turnos: [{ role: "user", texto: "¿qué tal?" }, { role: "assistant", texto: "Bien, señor." }, { role: "system", texto: "" }] });
  const filas = await all(s.db, "SELECT role, content, private, provider FROM messages WHERE conversation_id=? ORDER BY id", [r.conversationId]);
  assert.deepEqual(filas.map((f) => [f.role, f.content, Number(f.private), f.provider]), [["user", "¿qué tal?", 0, "conversa"], ["assistant", "Bien, señor.", 0, "conversa"]]);
  const b = await s.conversa.token(1);
  assert.equal((await s.conversa.fin(1, { id: b.id, turnos: [{ role: "user", texto: "mi contraseña es x" }] })).conversationId, null);
  assert.equal((await all(s.db, "SELECT id FROM conversations")).length, 1);
});

test("se niega con freno o desactivado; si Google falla no gasta minutos", async () => {
  await assert.rejects((await armar({ frenado: true })).conversa.token(1), (e) => e.error === "frenado");
  await assert.rejects((await armar({ config: { enabled: false } })).conversa.token(1), (e) => e.error === "desactivado");
  const s = await armar({ fetch: async () => ({ ok: false, status: 400, json: async () => ({}) }) });
  await assert.rejects(s.conversa.token(1), (e) => e.error === "sin_token");
  assert.equal(await s.usado(), 0);
});

test("las rutas exigen sesión web, respetan el freno real y la CSP permite el socket de Google", async (t) => {
  const { db } = await memDb();
  const llamadas = [];
  const ctx = await buildContext({ db, env: { OWNER_PASSWORD: "prueba-123", GEMINI_API_KEY: "k" }, fetch: bien(llamadas) });
  const server = createServer(createApp(ctx));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const pedir = async (path, { token, body = {} } = {}) => {
    const res = await fetch(`${base}/api${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  assert.equal((await pedir("/conversa/token")).status, 401);
  const sesion = (await pedir("/auth/login", { body: { password: "prueba-123" } })).data.token;
  const pc = (await pedir("/devices", { token: sesion, body: { name: "pc", kind: "pc" } })).data.token;
  assert.equal((await pedir("/conversa/token", { token: pc })).status, 403);
  const ok = await pedir("/conversa/token", { token: sesion });
  assert.equal(ok.status, 200);
  assert.equal((await pedir("/conversa/fin", { token: sesion, body: { id: ok.data.id } })).status, 200);
  await pedir("/control/freno", { token: sesion });
  assert.equal((await pedir("/conversa/token", { token: sesion })).data.error, "frenado");
  assert.match(csp("x"), /connect-src [^;]*wss:\/\/generativelanguage\.googleapis\.com/);
});

test("cliente: solo en escritorio, sin innerHTML, y suelta el micrófono", () => {
  const js = web("js/conversa.js");
  assert.ok(!/innerHTML/.test(js));
  assert.ok(js.includes("getTracks().forEach((t) => t.stop())"));
  assert.ok(js.includes("jarvis:freno"));
  assert.match(web("index.html"), /id="conversar"/);
  assert.match(web("index.html"), /js\/conversa\.js/);
  assert.ok(!web("m.html").includes("conversa"));
  assert.ok(web("sw.js").includes('"/js/conversa.js"'));
});
