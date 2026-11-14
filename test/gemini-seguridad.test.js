// Seguridad del Gemini del PC (agy): apagado por defecto, política por rol, guardián de eventos, topes y privacidad.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "../server/db/client.js";
import { buildContext } from "../server/context.js";
import { createApp } from "../server/app.js";
import { createHub } from "../server/ws-hub.js";
import { createHubClient } from "../desktop/runner/hub-client.js";
import { createWorker } from "../desktop/runner/worker.js";
import { createPrepare } from "../server/queue/prepare.js";
import { runAgy, guardTool } from "../desktop/runner/agy-runner.js";
import { buildAgyArgs } from "../desktop/runner/agy-args.js";
import { policyFor, commandAllowed } from "../desktop/runner/agy-policy.js";
import { runDoctor, limpiarCacheSonda } from "../desktop/runner/doctor.js";

const FAKE = fileURLToPath(new URL("./fixtures/fake-agy.mjs", import.meta.url));
const AGY = { command: process.execPath, prefix: [FAKE] };
const CAPS = { claude: { ok: true }, gemini_cli: { ok: true, cli: "agy", login: "google" } };
const ACCION = "abre el bloc de notas y crea un archivo"; // acción para el PC
let server, base, ctx, web, pc, tmp, gem;
const call = (path, { method = "GET", body, tk = web } = {}) =>
  fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(tk ? { authorization: `Bearer ${tk}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
const gemini = () => ctx.config.motores_pc.gemini;
const chat = async (text, engine) => (await call("/api/chat", { method: "POST", body: { text, engine } })).json();
const geminiTasks = async () => (await ctx.tasks.list(1)).filter((x) => x.engine === "gemini");
const clean = () => { for (const k of ["FAKE_CMD", "FAKE_DENY", "FAKE_STATUS", "FAKE_EDIT", "FAKE_QUOTA", "FAKE_503", "FAKE_RESULT", "FAKE_TOOL"]) delete process.env[k]; };
let n = 0;
const nuevoOut = () => join(tmp, `o${n++}`);

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "jarvis-seg-")); gem = join(tmp, "gem"); mkdirSync(gem, { recursive: true });
  ctx = await buildContext({ db: createDb({ url: ":memory:" }), env: { OWNER_PASSWORD: "prueba-123" } });
  ctx.permissions.carpetas_gemini = [gem];
  server = createServer(createApp(ctx));
  ctx.hub = createHub({ server, sessions: ctx.sessions, bus: ctx.bus });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  web = (await (await call("/api/auth/login", { method: "POST", body: { password: "prueba-123" }, tk: null })).json()).token;
  pc = (await (await call("/api/devices", { method: "POST", body: { name: "PC", kind: "pc" } })).json()).token;
});
after(() => { clean(); ctx.hub.close(); server.close(); rmSync(tmp, { recursive: true, force: true }); });

test("config: Gemini del PC viene APAGADO por defecto", () => {
  const cfg = JSON.parse(readFileSync(fileURLToPath(new URL("../config/providers.json", import.meta.url)), "utf8"));
  assert.equal(cfg.motores_pc.gemini.activo, false);
});

test("Gemini apagado: no encola (chat directo, selector, API) y el estado lo refleja", async () => {
  gemini().activo = false; await ctx.agent.hello(1, { capabilities: CAPS });
  assert.equal(ctx.agent.geminiReady(), false); assert.deepEqual(ctx.agent.engines(), ["claude"]);
  const a = await chat("/gemini haz algo"); assert.equal(a.status, "gemini_apagado"); assert.match(a.reply, /apagado/);
  const b = await chat(ACCION, "gemini"); assert.equal(b.status, "gemini_apagado");
  const c = await call("/api/tasks", { method: "POST", body: { text: "x", engine: "gemini" } });
  assert.equal(c.status, 409); assert.equal((await c.json()).error, "gemini_apagado");
  assert.equal((await geminiTasks()).length, 0);
  const st = await (await call("/api/status")).json();
  assert.equal(st.pc.gemini_activo, false);
  assert.equal(st.puestos.find((p) => p.id === "gemini_pc").estado, "apagado");
});

test("Gemini activo + PC apagado: la pregunta va a Flash con nota y la acción queda en cola", async () => {
  gemini().activo = true; await ctx.agent.hello(1, { capabilities: CAPS });
  ctx.state.pc.online = false; ctx.state.pc.last_seen = 0; // PC apagado
  const q = await chat("cuéntame un chiste corto", "gemini");
  assert.match(q.reply, /\(Flash: PC apagado\)/);
  const t = await chat(ACCION, "gemini");
  assert.equal(t.status, "tarea"); assert.equal(t.task.engine, "gemini"); assert.match(t.reply, /PC est[aá] apagado/);
  assert.equal((await geminiTasks()).length, 1);
});

test("topes independientes: Claude al tope no bloquea a Gemini y al revés; Auto pasa a Gemini solo si está activo", async () => {
  gemini().activo = true; await ctx.agent.hello(1, { capabilities: CAPS });
  const p = ctx.permissions; const old = [p.tope_claude, p.tope_gemini];
  p.tope_claude = { diario_tareas: 0 }; p.tope_gemini = {};
  assert.equal(await ctx.agent.capped(1, "claude"), true); assert.equal(await ctx.agent.capped(1, "gemini"), false);
  const a = await chat(ACCION, "auto"); assert.equal(a.task.engine, "gemini"); // Claude al tope y Gemini activo
  gemini().activo = false; // misma situación con Gemini apagado: se queda en Claude
  const b = await chat(ACCION, "auto"); assert.equal(b.task.engine, "claude");
  p.tope_claude = {}; p.tope_gemini = { diario_tareas: 0 };
  assert.equal(await ctx.agent.capped(1, "gemini"), true); assert.equal(await ctx.agent.capped(1, "claude"), false);
  gemini().activo = true;
  const c = await chat(ACCION, "auto"); assert.equal(c.task.engine, "claude"); // Gemini al tope no frena a Claude
  [p.tope_claude, p.tope_gemini] = old;
});

test("planificador: contenido privado nunca llama a Gemini (espía)", async () => {
  let llamadas = 0;
  const planner = { model: "espia", chat: async () => { llamadas++; return { text: "{}" }; } };
  const router = { route: async () => ({ ok: true, text: '{"resumen":"r","pasos":["a"],"preguntas":[]}', provider: "groq" }) };
  const tasks = { create: async (o) => ({ id: 1, ...o }) };
  const prep = createPrepare({ router, tasks, planner, privacy: { assert() {} } });
  await prep.prepare({ userId: 1, text: "mis claves son secretas", isPrivate: true, engine: "claude" });
  await assert.rejects(prep.prepare({ userId: 1, text: "mis claves", isPrivate: true, engine: "gemini" }), /privado_no_gemini/);
  assert.equal(llamadas, 0);
  await prep.prepare({ userId: 1, text: "ordena mi carpeta pública", isPrivate: false, engine: "gemini" });
  assert.equal(llamadas, 1); // el espía sí detecta una llamada legítima
});

test("worker con Gemini apagado no ejecuta agy y falla con mensaje claro", async () => {
  const out = nuevoOut(); clean(); process.env.FAKE_OUT = out;
  let fin = null; const hub = { finish: async (id, b) => { fin = b; } };
  const w = createWorker({ hub, agy: AGY, fallbackCwd: tmp, geminiFolders: [gem] }); // sin hello: motores.gemini.activo no es true
  await w.processTask({ id: 1, seq: 1, engine: "gemini", mode: "directo", text: "x", sha256: "x" }, {});
  assert.equal(fin.status, "fallida"); assert.match(fin.result, /apagado/); assert.equal(existsSync(`${out}.0.stdin`), false);
});

test("worker real: ruta fuera de carpetas_gemini => rechazada; dentro => hecha", async () => {
  gemini().activo = true; ctx.state.pc.online = true;
  const hub = createHubClient({ baseUrl: base, token: pc });
  await hub.hello({ version: "0", host: "PC", capabilities: CAPS });
  const w = createWorker({ hub, agy: AGY, claude: AGY, geminiFolders: [gem], fallbackCwd: tmp, getCapabilities: () => CAPS });
  await w.sync();
  const correr = async (env) => {
    clean(); Object.assign(process.env, { FAKE_OUT: nuevoOut() }, env);
    const t = await ctx.tasks.create({ userId: 1, rawText: "haz algo", mode: "directo", engine: "gemini" });
    await ctx.tasks.reassign?.(1, t.id, "gemini");
    for (let i = 0; i < 6 && !["hecha", "fallida", "rechazada"].includes((await ctx.tasks.get(1, t.id)).status); i++) await w.tick();
    return ctx.tasks.get(1, t.id);
  };
  const fuera = await correr({ FAKE_TOOL: JSON.stringify({ name: "write_file", params: { TargetFile: join(tmp, "fuera.txt") } }) });
  assert.equal(fuera.status, "rechazada"); assert.match(fuera.result, /fuera de las carpetas/i);
});

test("runAgy: sin carpeta permitida o cwd fuera, no se ejecuta agy", async () => {
  const out = nuevoOut(); clean(); process.env.FAKE_OUT = out;
  const a = await runAgy({ ...AGY, args: buildAgyArgs({ prompt: "x" }), cwd: tmp, allowedDirs: [] });
  assert.equal(a.isError, true); assert.equal(a.blocked.kind, "fuera_de_carpeta");
  const b = await runAgy({ ...AGY, args: buildAgyArgs({ prompt: "x" }), cwd: tmp, allowedDirs: [gem] });
  assert.equal(b.isError, true); assert.equal(existsSync(`${out}.0.stdin`), false);
});

async function agyRun(env, policy) {
  clean(); Object.assign(process.env, { FAKE_OUT: nuevoOut() }, env);
  return runAgy({ ...AGY, args: buildAgyArgs({ prompt: "x" }), cwd: gem, allowedDirs: [gem], policy });
}
const tool = (name, params) => ({ FAKE_TOOL: JSON.stringify({ name, params }) });

test("guardián: ruta fuera de carpetas_gemini mata el proceso y marca fallida", async () => {
  const r = await agyRun(tool("write_file", { TargetFile: join(tmp, "fuera.txt") }), "programar");
  assert.equal(r.aborted, "comando_bloqueado"); assert.equal(r.blocked.kind, "fuera_de_carpeta"); assert.equal(r.isError, true);
  const rel = await agyRun(tool("read_file", { AbsolutePath: "../secreto.txt" }), "programar");
  assert.equal(rel.blocked.kind, "fuera_de_carpeta");
  const ok = await agyRun(tool("write_file", { TargetFile: join(gem, "ok.txt") }), "programar");
  assert.equal(ok.blocked, null); assert.equal(ok.isError, false);
});

test("guardián: lectura sin comandos ni escritura; programar solo comandos de la lista corta", async () => {
  assert.equal((await agyRun({ FAKE_CMD: "git status" }, "lectura")).blocked.kind, "comando_no_permitido");
  assert.equal((await agyRun(tool("write_file", { TargetFile: join(gem, "a.txt") }), "lectura")).blocked.kind, "escritura_no_permitida");
  assert.equal((await agyRun({ FAKE_CMD: "git status" }, "programar")).blocked, null);
  assert.ok((await agyRun({ FAKE_CMD: "curl http://x.com" }, "programar")).blocked);
  assert.ok((await agyRun({ FAKE_CMD: "git status && del x" }, "programar")).blocked);
  assert.equal((await agyRun(tool("browser_navigate", { Url: "http://x" }), "programar")).blocked.kind, "herramienta_no_permitida");
  assert.equal(policyFor({ role: "planear" }), "lectura"); assert.equal(policyFor({ role: "verificar" }), "lectura");
  assert.equal(policyFor({ role: "programar", mode: "editar" }), "programar");
  assert.equal(commandAllowed("git diff HEAD~1"), true); assert.equal(commandAllowed("git diff > x"), false);
});

test("rechazos de permiso (FAKE_DENY, FAKE_STATUS) cuentan como fallo", async () => {
  const d = await agyRun({ FAKE_DENY: "permission denied by user" }, "programar");
  assert.equal(d.isError, true); assert.ok(d.denials.length >= 1); assert.equal(d.errorKind, "permiso");
  assert.equal((await agyRun({ FAKE_STATUS: "ERROR" }, "programar")).isError, true);
});

test("args de agy: nunca modo automático ni --dangerously-skip-permissions", () => {
  const s = buildAgyArgs({ prompt: "x" }).join(" ");
  assert.ok(!/dangerously|--mode(s|=)|always-proceed|auto/.test(s)); assert.ok(s.includes("--sandbox"));
  assert.ok(guardTool({ tool: "write_file", params: { TargetFile: "../x" } }, [gem], gem));
});

test("doctor: con Gemini apagado no se ejecuta agy y las capacidades lo dicen", async () => {
  const llamadas = [];
  limpiarCacheSonda();
  const r = await runDoctor({ exec: async (b, args) => { llamadas.push(b.command); return args.includes("--version") ? "1.5.8" : JSON.stringify({ is_error: false, result: "ok" }); }, agyPath: "agy.exe", claudePath: "claude.exe", geminiActivo: false });
  assert.equal(r.agy.activo, false); assert.equal(r.agy.ok, false); assert.equal(r.gemini_cli.ok, false);
  assert.ok(llamadas.length && llamadas.every((c) => c === "claude.exe")); // solo Claude (versión + sonda de modelos); agy nunca
  assert.equal(r.claude.ok, true); assert.deepEqual(r.claude.modelos, ["claude-opus-5-5", "claude-sonnet-5-5"]);
});
