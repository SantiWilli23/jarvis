import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createDb } from "../server/db/client.js";
import { buildContext } from "../server/context.js";
import { createApp } from "../server/app.js";
import { redact, cleanDiff } from "../server/pro/redact.js";
import { check } from "../server/pro/check.js";
import { classifyTask } from "../server/pro/classify.js";

let server, base, ctx, web, pc, thread, events;
const call = (path, { method = "GET", body, tk = web } = {}) =>
  fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), authorization: `Bearer ${tk}` }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
const CAPS = { claude: { ok: true, modelos: ["claude-opus-5-5", "claude-sonnet-5-5"] }, agy: { ok: true, login: "google" }, repos: ["C:\\dev\\app"] };
const hello = (capabilities = CAPS) => call("/api/agent/hello", { method: "POST", tk: pc, body: { host: "pc", capabilities } });
const claim = async (body = {}) => (await call("/api/agent/pro/claim", { method: "POST", tk: pc, body })).job;
const report = (id, b) => call(`/api/agent/pro/jobs/${id}/report`, { method: "POST", tk: pc, body: b });
const fail = (id, error) => call(`/api/agent/pro/jobs/${id}/fail`, { method: "POST", tk: pc, body: { error } });
const INF = (files, res = "ok") => ({ dijo_hizo: ["cambio"], archivos_tocados: files, comandos: [], resultado: res });
const NS = (...f) => f.map((x) => `M\t${x}`).join("\n") + "\n";
const VER = (v = "aprobado") => ({ dijo_no_hizo: [], hizo_no_dijo: [], cambios_ajenos: [], veredicto: v });
const say = (text) => call(`/api/pro/threads/${thread}/messages`, { method: "POST", body: { text } });
const round = async (id) => (await call(`/api/pro/threads/${thread}`)).rounds.find((r) => r.id === id);
const decide = (rid, body) => call(`/api/pro/rounds/${rid}/decision`, { method: "POST", body });

before(async () => {
  ctx = await buildContext({ db: createDb({ url: ":memory:" }), env: { OWNER_PASSWORD: "x-123" } }); ctx.config.motores_pc.gemini.activo = true; ctx.pro.config.local_visible = true;
  ctx.permissions.carpetas_permitidas = ["C:\\dev"]; ctx.permissions.carpetas_gemini = ctx.permissions.carpetas_permitidas;
  server = createServer(createApp(ctx));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  web = (await (await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "x-123" }) })).json()).token;
  pc = (await call("/api/devices", { method: "POST", body: { name: "PC", kind: "pc" } })).token;
  events = []; for (const e of ["pro.message", "pro.round", "pro.delta", "pc.using"]) ctx.bus.on(e, (x) => events.push([e, x]));
});
after(() => server.close());


const habilitar = async () => { await hello(); const t = await call("/api/pro/threads", { method: "POST", body: { repo: "C:\\dev\\app" } }); thread = t.thread.id; };

test("solo Claude: con Gemini apagado la ronda se programa y verifica con Claude (Opus revisa a Sonnet)", async () => {
  ctx.config.motores_pc.gemini.activo = false;
  await habilitar();
  const r = await say("mejora el css de la pantalla y los colores");
  assert.equal(r.status, 201); assert.equal(r.round.programmer, "claude"); assert.equal(r.round.verifier, "claude");
  const v = await call("/api/pro/status"); assert.equal(v.habilitado, true); assert.ok(v.avisos.includes("gemini_apagado"));
  const j = await claim(); assert.equal(j.model, "claude-opus-5-5"); assert.deepEqual(j.fallback_models, ["claude-sonnet-5-5"]);
  await call("/api/pro/rounds/" + r.round.id + "/cancel", { method: "POST" });
  assert.equal((await round(r.round.id)).status, "cancelada");
});

test("envío atómico: dos mensajes a la vez -> solo una ronda (el otro 409 ronda_activa)", async () => {
  const [a, b] = await Promise.all([say("arregla el bug uno del servidor"), say("arregla el bug dos del servidor")]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  const ganadora = a.status === 201 ? a : b;
  await call("/api/pro/rounds/" + ganadora.round.id + "/cancel", { method: "POST" });
});

test("fallo del paso y Reintentar paso; reinicio del PC marca el job como fallido", async () => {
  const r = await say("arregla el bug del servidor otra vez");
  const j1 = await claim(); await fail(j1.id, "claude_error: algo");
  assert.equal((await round(r.round.id)).status, "fallida");
  const re = await call("/api/pro/rounds/" + r.round.id + "/reintentar", { method: "POST" });
  assert.equal(re.status, 200); assert.equal(re.round.status, "planeando");
  const j2 = await claim(); assert.equal(j2.role, "planear"); assert.notEqual(j2.id, j1.id);
  await hello(); // el PC reinició: lo que tenía en marcha se da por fallido
  assert.equal((await round(r.round.id)).status, "fallida");
  assert.equal((await call("/api/pro/rounds/" + r.round.id + "/reintentar", { method: "POST" })).status, 200);
  assert.equal((await call("/api/pro/rounds/" + r.round.id + "/reintentar", { method: "POST" })).status, 409); // ya hay un paso en curso
  await call("/api/pro/rounds/" + r.round.id + "/cancel", { method: "POST" });
});

test("plan editado al aprobar: el programador recibe el plan editado y queda en el hilo", async () => {
  const r = await say("arregla el bug del servidor con plan");
  const p = await claim(); await report(p.id, { informe: "1. plan original", usage: {} });
  const d = await decide(r.round.id, { accion: "aprobar", text: "1. plan EDITADO por el usuario" });
  assert.equal(d.status, 200);
  const j = await claim(); assert.equal(j.role, "programar"); assert.ok(j.prompt.includes("plan EDITADO por el usuario")); assert.ok(!j.prompt.includes("plan original"));
  const msgs = (await call("/api/pro/threads/" + thread)).messages;
  assert.ok(msgs.some((m) => m.author === "usuario" && m.kind === "plan" && m.text.includes("EDITADO")));
  await call("/api/pro/rounds/" + r.round.id + "/cancel", { method: "POST" });
});

test("Opus de reserva: el aviso queda en el hilo y model_real en el job", async () => {
  const r = await say("arregla el bug del servidor con reserva");
  const p = await claim();
  await report(p.id, { informe: "1. plan", usage: {}, modelo_real: "claude-sonnet-5-5", fallback: { de: "claude-opus-5-5", a: "claude-sonnet-5-5", motivo: "sin_cuota" } });
  const msgs = (await call("/api/pro/threads/" + thread)).messages;
  assert.ok(msgs.some((m) => m.author === "jarvis" && /Sonnet|sonnet/.test(m.text) && /Opus|opus/.test(m.text) && m.meta?.aviso === "modelo_cambiado"));
  assert.equal((await call("/api/pro/jobs/" + p.id)).job.model_real, "claude-sonnet-5-5");
  await call("/api/pro/rounds/" + r.round.id + "/cancel", { method: "POST" });
});
