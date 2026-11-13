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
const CAPS = { claude: { ok: true, modelos: ["opus", "sonnet"] }, agy: { ok: true, login: "google" }, repos: ["C:\\dev\\app"] };
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
  ctx = await buildContext({ db: createDb({ url: ":memory:" }), env: { OWNER_PASSWORD: "x-123" } }); ctx.config.motores_pc.gemini.activo = true;
  ctx.permissions.carpetas_permitidas = ["C:\\dev"];
  server = createServer(createApp(ctx));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  web = (await (await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "x-123" }) })).json()).token;
  pc = (await call("/api/devices", { method: "POST", body: { name: "PC", kind: "pc" } })).token;
  events = []; for (const e of ["pro.message", "pro.round", "pro.delta", "pc.using"]) ctx.bus.on(e, (x) => events.push([e, x]));
});
after(() => server.close());

test("Pro deshabilitado: motivos y 409; habilitado con agy", async () => {
  const s = await call("/api/pro/status");
  assert.equal(s.habilitado, false);
  assert.ok(s.motivos.includes("pc_apagado"));
  await hello({ ...CAPS, agy: { ok: false } });
  assert.deepEqual((await call("/api/pro/status")).motivos, ["gemini_sin_login"]);
  const t = await call("/api/pro/threads", { method: "POST", body: { repo: "C:\\dev\\app" } }); // repo no declarado aun? si esta declarado
  assert.equal(t.status, 201);
  thread = t.thread.id;
  const r = await say("arregla el bug");
  assert.equal(r.status, 409); assert.deepEqual(r.motivos, ["gemini_sin_login"]);
  await hello();
  assert.equal((await call("/api/pro/status")).habilitado, true);
  assert.equal((await call("/api/pro/threads", { method: "POST", body: { repo: "D:\\otro" } })).status, 422);
});

test("privado rechazado 422 y secretos redactados", async () => {
  assert.equal((await say("mi contraseña es hunter22")).status, 422);
  const r = await say("arregla el bug usando OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwx en el servidor");
  assert.equal(r.status, 201);
  assert.ok(!r.message.text.includes("sk-abcdef"));
  const j = await claim();
  assert.ok(!j.prompt.includes("sk-abcdef"));
  await fail(j.id, "timeout");
  assert.equal((await round(r.round.id)).status, "fallida");
});

test("ronda feliz: plan, aprobar, programar, verificar con el otro motor, aceptar, commit", async () => {
  const r = await say("arregla el bug del servidor");
  const rid = r.round.id;
  assert.equal(r.round.programmer, "claude");
  assert.equal((await say("otra")).status, 409);
  const plan = await claim();
  assert.equal(plan.role, "planear"); assert.equal(plan.model, "opus"); assert.equal(plan.mode, "solo_lectura");
  await call(`/api/agent/pro/jobs/${plan.id}/events`, { method: "POST", tk: pc, body: { events: [{ kind: "x", text: "leyendo" }] } });
  assert.ok(events.some(([e, x]) => e === "pro.delta" && x.text === "leyendo"));
  assert.ok(events.some(([e, x]) => e === "pc.using" && x.id === "claude_pc"));
  await report(plan.id, { informe: "1. tocar server/a.js", usage: { tokens_in: 10, tokens_out: 5 } });
  assert.equal((await round(rid)).status, "esperando_aprobacion");
  assert.equal(await claim(), null);
  await decide(rid, { accion: "aprobar" });
  const prog = await claim();
  assert.equal(prog.role, "programar"); assert.equal(prog.model, "sonnet"); assert.equal(prog.mode, "editar");
  assert.ok(prog.prompt.includes("tocar server/a.js"));
  assert.ok((await report(prog.id, { informe: INF(["server/a.js"]), tree_before: "a", tree_after: "b", diff: NS("server/a.js") })).ok);
  assert.equal((await report(prog.id, { informe: INF(["server/a.js"]), diff: NS("server/a.js") })).duplicado, true);
  const ver = await claim();
  assert.equal(ver.role, "verificar"); assert.equal(ver.engine, "gemini"); assert.ok(ver.prompt.includes("server/a.js"));
  await report(ver.id, { informe: JSON.stringify(VER()) });
  assert.equal((await round(rid)).status, "esperando_aprobacion");
  await decide(rid, { accion: "aprobar" });
  const cm = await claim();
  assert.equal(cm.role, "commit");
  await report(cm.id, { informe: { resultado: "ok" } });
  assert.equal((await round(rid)).status, "hecha");
  assert.equal((await ctx.agent.usageToday(ctx.ownerId)).ai.claude.tokens, 15);
});

test("mentira detectada (dijo_no_hizo) y tope de 2 correcciones", async () => {
  const r = await say("arregla el bug otra vez");
  const rid = r.round.id;
  await report((await claim()).id, { informe: "plan" });
  await decide(rid, { accion: "aprobar" });
  for (let i = 0; i < 3; i++) {
    const prog = await claim();
    assert.equal(prog.role, "programar");
    await report(prog.id, { informe: INF(["test/y.test.js", "server/a.js"]), diff: NS("server/a.js") });
    const ver = await claim();
    await report(ver.id, { informe: VER("aprobado") }); // la IA aprueba; la comprobacion determinista no
    const st = await round(rid);
    if (i < 2) { assert.equal(st.status, "corrigiendo"); assert.equal(st.corrections, i + 1); }
    else { assert.equal(st.status, "necesita_usuario"); assert.equal(st.corrections, 2); }
  }
  const d = await call(`/api/pro/threads/${thread}`);
  assert.ok(d.messages.some((m) => m.kind === "verificacion" && /test\/y\.test\.js/.test(m.text)));
  await decide(rid, { accion: "corregir", text: "añade el test" });
  assert.equal((await round(rid)).corrections, 0);
  assert.equal((await round(rid)).status, "corrigiendo");
  await call(`/api/pro/rounds/${rid}/cancel`, { method: "POST" });
  assert.equal((await round(rid)).status, "cancelada");
  assert.equal(await claim(), null);
});

test("Gemini sin cuota al planear: no baja de modelo y avisa", async () => {
  const r = await say("mejora el css de la pantalla y los colores");
  assert.equal(r.round.programmer, "gemini");
  const j = await claim();
  assert.equal(j.model, "gemini-3.8-flash-high");
  await fail(j.id, "sin_cuota");
  assert.equal((await round(r.round.id)).status, "necesita_usuario");
  assert.ok((await call(`/api/pro/threads/${thread}`)).messages.at(-1).text.includes("No cambio de modelo"));
  await call(`/api/pro/rounds/${r.round.id}/cancel`, { method: "POST" });
});

test("aprobacion con pro_job_id y reclamo reenviado (Render dormido)", async () => {
  const r = await say("arregla el bug del api");
  const j = await claim();
  const a = await call(`/api/agent/pro/jobs/${j.id}/approval`, { method: "POST", tk: pc, body: { kind: "npm_test", summary: "npm test" } });
  assert.equal(a.status, 201);
  assert.equal((await call(`/api/agent/pro/approvals/${a.approval.id}`, { tk: pc })).status, "pendiente");
  const row = await ctx.db.execute({ sql: "SELECT pro_job_id FROM approvals WHERE id=?", args: [a.approval.id] });
  assert.equal(Number(row.rows[0].pro_job_id), j.id);
  assert.equal(await claim(), null);
  assert.equal((await claim({ again: j.id })).id, j.id);
  await report(j.id, { informe: "plan" }); await report(j.id, { informe: "plan" });
  assert.equal((await round(r.round.id)).status, "esperando_aprobacion");
  await call(`/api/pro/rounds/${r.round.id}/cancel`, { method: "POST" });
});

test("unidades: redact, cleanDiff, check, classify", async () => {
  assert.ok(!redact("Bearer abcdefghijklmnop y AIzaSyA1234567890abcdefghijklmn").match(/abcdefghijklmnop|AIza/));
  assert.ok(redact("PASSWORD=secreto1").includes("[SECRETO]"));
  const d = cleanDiff("diff --git a/.env b/.env\n+TOKEN=zzzz\ndiff --git a/a.js b/a.js\n+ok\n");
  assert.ok(!d.includes("zzzz") && d.includes("+ok"));
  const c = check({ informe: INF(["a.js"]), diff: "M\tb.js\nM\t.env\n" });
  assert.equal(c.dijo_no_hizo.length, 1); assert.equal(c.hizo_no_dijo.length, 1); assert.equal(c.cambios_ajenos.length, 1);
  assert.equal((await classifyTask("haz algo")).programmer, "claude");
  assert.equal((await classifyTask("arregla el bug en la pantalla css", { textProvider: async () => "gemini" })).programmer, "gemini");
});
