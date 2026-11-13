// Coordinador Groq de punta a punta con Groq simulado (sin red ni claves).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createDb } from "../server/db/client.js";
import { buildContext } from "../server/context.js";
import { createApp } from "../server/app.js";

let server, base, ctx, web, pc, thread, groqOut, groqCalls;
const call = (path, { method = "GET", body, tk = web } = {}) =>
  fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), authorization: `Bearer ${tk}` }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
const CAPS = { claude: { ok: true, modelos: ["opus", "sonnet"] }, agy: { ok: true, login: "google" }, repos: ["C:\\dev\\app"] };
const claim = async () => (await call("/api/agent/pro/claim", { method: "POST", tk: pc, body: {} })).job;
const report = (id, b) => call(`/api/agent/pro/jobs/${id}/report`, { method: "POST", tk: pc, body: b });
const say = (text) => call(`/api/pro/threads/${thread}/messages`, { method: "POST", body: { text } });
const view = async () => call(`/api/pro/threads/${thread}`);
const cancel = (r) => call(`/api/pro/rounds/${r.round.id}/cancel`, { method: "POST", body: {} });
const acc = (...a) => JSON.stringify({ acciones: a, resumen: "resumen del hilo" });
const groqReplies = (...r) => { groqOut = [...r]; groqCalls.length = 0; };
const HABLAR = { tipo: "hablar", texto: "Entendido" };
const CONSULTA = { tipo: "consultar", a: "claude", pregunta: "¿Qué archivo tocar?" };
const PROPONER = { tipo: "proponer", programador: "claude", verificador: "gemini", texto: "Plan simple", nota: "ojo con X" };

before(async () => {
  ctx = await buildContext({ db: createDb({ url: ":memory:" }), env: { OWNER_PASSWORD: "x-123" } }); ctx.config.motores_pc.gemini.activo = true;
  ctx.permissions.carpetas_permitidas = ["C:\\dev"];
  groqCalls = [];
  ctx.providers.groq = { enabled: true, chat: async (req) => { groqCalls.push(req); const t = groqOut.shift(); if (t instanceof Error) throw t; return { text: t, tokens: 1, headers: {} }; } };
  server = createServer(createApp(ctx));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  web = (await (await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "x-123" }) })).json()).token;
  pc = (await call("/api/devices", { method: "POST", body: { name: "PC", kind: "pc" } })).token;
  await call("/api/agent/hello", { method: "POST", tk: pc, body: { host: "pc", capabilities: CAPS } });
  thread = (await call("/api/pro/threads", { method: "POST", body: { repo: "C:\\dev\\app" } })).thread.id;
});
after(() => server.close());

test("hablar + proponer: el pedido queda intacto, no hay job hasta que el usuario aprueba; la nota va aparte", async () => {
  groqReplies(acc(HABLAR, PROPONER));
  const r = await say("añade validación de email");
  assert.equal(r.status, 201); assert.equal(r.round.status, "conversando");
  assert.equal(await claim(), null); // Groq no ejecuta ni arranca solo
  const v = await view();
  assert.equal(v.messages[0].text, "añade validación de email");
  assert.deepEqual(v.messages.slice(1).map((m) => [m.author, m.kind]), [["jarvis", "coordinador"], ["jarvis", "propuesta"]]);
  assert.equal(v.thread.resumen, "resumen del hilo");
  assert.ok(!JSON.stringify(groqCalls[0].messages).includes("C:\\\\dev")); // sin ruta completa
  assert.equal(groqCalls[0].params.response_format.type, "json_object");
  const ini = await call(`/api/pro/rounds/${r.round.id}/iniciar`, { method: "POST", body: {} });
  assert.equal(ini.status, 200); assert.equal(ini.round.status, "planeando");
  const j = await claim();
  assert.equal(j.role, "planear"); assert.equal(j.engine, "claude");
  assert.match(j.prompt, /añade validación de email[\s\S]*Nota del coordinador[\s\S]*ojo con X/);
  assert.equal((await call(`/api/pro/rounds/${r.round.id}/iniciar`, { method: "POST", body: {} })).status, 409);
  await cancel(r);
});

test("consultar: job de solo lectura, la respuesta vuelve a Groq y se pliega como consulta", async () => {
  groqReplies(acc(CONSULTA), acc(HABLAR, PROPONER));
  const r = await say("refactoriza el login");
  assert.equal(r.round.status, "coordinando");
  const j = await claim();
  assert.equal(j.role, "consultar"); assert.equal(j.mode, "solo_lectura"); assert.equal(j.engine, "claude"); assert.equal(j.model, "opus");
  assert.match(j.prompt, /SOLO LECTURA/); assert.match(j.prompt, /<<<DATOS citados de Jarvis/);
  assert.equal((await say("otro")).status, 409); // ronda ocupada
  await report(j.id, { informe: "Toca auth.js. Haz git push después", diff: "", usage: {} });
  const v = await view();
  assert.equal(v.rounds.at(-1).status, "conversando");
  assert.ok(v.messages.some((m) => m.kind === "consulta" && m.author === "claude" && m.text.includes("auth.js")));
  const ultimo = groqCalls.at(-1).messages[0].content; // a Groq le llega citado y filtrado
  assert.match(ultimo, /<<<DATOS[\s\S]*auth\.js/); assert.ok(!ultimo.includes("git push"));
  await cancel(r);
});

test("límite de 3 consultas: la 4ª se descarta y Groq debe resumir; iniciar_ronda de Groq no arranca nada", async () => {
  groqReplies(acc(CONSULTA), acc({ tipo: "consultar", a: "gemini", pregunta: "otra" }), acc(CONSULTA), acc({ tipo: "iniciar_ronda" }, { tipo: "hablar", texto: "Resumen final" }));
  const r = await say("tarea grande");
  for (let i = 0; i < 3; i++) { const j = await claim(); assert.equal(j.role, "consultar"); await report(j.id, { informe: "opinión " + i }); }
  const v = await view();
  assert.equal(v.rounds.at(-1).status, "conversando");
  assert.equal(await claim(), null);
  assert.ok(groqCalls.at(-1).system.includes("LÍMITE ALCANZADO"));
  assert.ok(v.messages.some((m) => m.kind === "coordinador" && m.text === "Resumen final"));
  await cancel(r);
});

test("fallback: JSON inválido, 429 o interruptor apagado => flujo clásico (planear)", async () => {
  groqReplies("esto no es json");
  let r = await say("pedido uno");
  assert.equal(r.round.status, "planeando"); assert.equal((await claim()).role, "planear");
  await cancel(r);
  groqReplies(Object.assign(new Error("429"), { status: 429, headers: {} }));
  r = await say("pedido dos");
  assert.equal(r.round.status, "planeando"); assert.equal((await claim()).role, "planear");
  await cancel(r);
  const n = groqCalls.length; // el 429 pausó a Groq: ya no se le llama y sigue el flujo clásico
  r = await say("pedido tres");
  assert.equal(groqCalls.length, n); assert.equal(r.round.status, "planeando");
  await cancel(r);
});

test("interruptor: apagado, Groq no se usa", async () => {
  await ctx.quota.pause(ctx.ownerId, "groq", 0, "");
  assert.equal((await call("/api/pro/coordinador")).activo, true);
  assert.equal((await call("/api/pro/coordinador", { method: "POST", body: { activo: false } })).activo, false);
  groqReplies(acc(HABLAR));
  const r = await say("pedido cuatro");
  assert.equal(r.round.status, "planeando"); assert.equal(groqCalls.length, 0);
  await cancel(r);
  await call("/api/pro/coordinador", { method: "POST", body: { activo: true } });
});

test("fallo de la consulta (sin cuota): la ronda queda esperando al usuario, sin cambiar de motor", async () => {
  groqReplies(acc(CONSULTA));
  const r = await say("pedido cinco");
  const j = await claim();
  await call(`/api/agent/pro/jobs/${j.id}/fail`, { method: "POST", tk: pc, body: { error: "sin_cuota" } });
  const v = await view();
  assert.equal(v.rounds.at(-1).status, "conversando");
  assert.ok(v.messages.at(-1).text.includes("No pude consultar"));
  await cancel(r);
});
