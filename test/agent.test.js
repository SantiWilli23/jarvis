import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "../server/db/client.js";
import { buildContext } from "../server/context.js";
import { createApp } from "../server/app.js";
import { createHub } from "../server/ws-hub.js";
import { createHubClient } from "../desktop/runner/hub-client.js";
import { createWorker } from "../desktop/runner/worker.js";
import { buildArgs } from "../desktop/runner/claude-args.js";
import { classifyDenial } from "../desktop/runner/danger.js";

const FAKE = fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url));
const sha = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

let server, base, ctx, webToken, pcToken, tmp;
const call = (path, { method = "GET", body, tk = webToken } = {}) =>
  fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(tk ? { authorization: `Bearer ${tk}` } : {}) }, body: body ? JSON.stringify(body) : undefined });

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "jarvis-agent-"));
  const db = createDb({ url: ":memory:" });
  ctx = await buildContext({ db, env: { OWNER_PASSWORD: "prueba-123" } });
  ctx.permissions.carpetas_permitidas = [join(tmp, "trabajo")];
  server = createServer(createApp(ctx));
  ctx.hub = createHub({ server, sessions: ctx.sessions, bus: ctx.bus });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  webToken = (await (await call("/api/auth/login", { method: "POST", body: { password: "prueba-123" }, tk: null })).json()).token;
  pcToken = (await (await call("/api/devices", { method: "POST", body: { name: "PC", kind: "pc" } })).json()).token;
});
after(() => { ctx.hub.close(); server.close(); rmSync(tmp, { recursive: true, force: true }); });

const hubC = () => createHubClient({ baseUrl: base, token: pcToken });
function mkWorker(mode, extra = {}) {
  const out = join(tmp, `o-${Math.random().toString(36).slice(2)}`);
  process.env.FAKE_OUT = out; process.env.FAKE_MODE = mode;
  const w = createWorker({ hub: hubC(), claude: { command: process.execPath, prefix: [FAKE] }, fallbackCwd: tmp, approvalPollMs: 20, ...extra });
  return { w, out };
}
const decideNext = async (approve) => {
  for (let i = 0; i < 200; i++) {
    const p = (await (await call("/api/approvals")).json()).approvals;
    if (p.length) return (await call(`/api/approvals/${p[0].id}`, { method: "POST", body: { approve } })).json();
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("no apareció la aprobación");
};

test("/api/agent/*: exige token de agente (sin token 401; web y atajo 403)", async () => {
  assert.equal((await call("/api/agent/claim", { method: "POST", tk: null })).status, 401);
  assert.equal((await call("/api/agent/claim", { method: "POST", body: {} })).status, 403);
  const sc = (await (await call("/api/devices", { method: "POST", body: { kind: "shortcut" } })).json()).token;
  assert.equal((await call("/api/agent/claim", { method: "POST", body: {}, tk: sc })).status, 403);
});

test("el token del PC no sirve para aprobar ni leer el resto de la API", async () => {
  assert.equal((await call("/api/approvals", { tk: pcToken })).status, 403);
  assert.equal((await call("/api/chat", { method: "POST", body: { text: "hola" }, tk: pcToken })).status, 403);
});

test("hello marca PC en línea, emite pc_online y se ve en /api/status", async () => {
  let evento = 0; ctx.bus.on("pc_online", () => evento++);
  const r = await (await call("/api/agent/hello", { method: "POST", body: { version: "0.1.0", host: "MI-PC" }, tk: pcToken })).json();
  assert.equal(r.ok, true);
  assert.equal(evento, 1);
  const st = await (await call("/api/status")).json();
  assert.equal(st.pc.online, true);
  assert.equal(st.pc.host, "MI-PC");
});

test("sin latidos el PC pasa a desconectado", async () => {
  const fake = ctx.state.pc.last_seen;
  ctx.state.pc.last_seen = fake - 60_000;
  assert.equal(ctx.agent.sweep(), true);
  assert.equal((await (await call("/api/status")).json()).pc.online, false);
});

test("modo directo: los bytes exactos llegan intactos al stdin del claude falso", async () => {
  const exacto = "  hola 🚀\r\nlínea «dos»  \t\n";
  const t = await ctx.direct.enqueue({ userId: ctx.ownerId, text: exacto });
  const { w, out } = mkWorker("ok");
  assert.equal(await w.tick(), "tarea");
  const recibido = readFileSync(`${out}.0.stdin`);
  assert.equal(recibido.toString("hex"), Buffer.from(exacto, "utf8").toString("hex"));
  assert.equal(createHash("sha256").update(recibido).digest("hex"), t.sha256);
  const args = JSON.parse(readFileSync(`${out}.0.args.json`, "utf8"));
  assert.ok(args.includes("-p") && args.includes("stream-json") && args.includes("--verbose"));
  assert.ok(!args.includes("--bare") && !args.includes("--dangerously-skip-permissions"));
  assert.match(args[args.indexOf("--append-system-prompt") + 1], /\d{4}-\d\d-\d\dT/); // la hora va aparte
  const fin = await ctx.tasks.get(ctx.ownerId, t.id);
  assert.equal(fin.status, "hecha");
  assert.equal(fin.result, "Listo, señor.");
  const u = await ctx.agent.usageToday(ctx.ownerId);
  assert.ok(u.tareas >= 1 && u.tokens >= 170);
});

test("modo preparar: el pedido original va íntegro dentro del stdin con el plan", async () => {
  const orig = "ordena la carpeta  \r\n";
  await ctx.tasks.create({ userId: ctx.ownerId, rawText: orig, mode: "preparar", prepared: { resumen: "Ordenar", pasos: ["listar", "mover"], preguntas: [] } });
  const { w, out } = mkWorker("ok");
  await w.tick();
  const s = readFileSync(`${out}.0.stdin`, "utf8");
  assert.ok(s.includes(orig) && s.includes("1. listar"));
});

test("acción peligrosa: pide aprobación; con 'sí' continúa la sesión con permiso exacto", async () => {
  const t = await ctx.direct.enqueue({ userId: ctx.ownerId, text: "borra viejo.txt" });
  const { w, out } = mkWorker("deny");
  const p = w.tick();
  const dec = await decideNext(true);
  assert.equal(dec.approval.status, "aprobada");
  await p;
  const a2 = JSON.parse(readFileSync(`${out}.1.args.json`, "utf8"));
  assert.equal(a2[a2.indexOf("--resume") + 1], "sesion-falsa-1");
  assert.ok(a2[a2.indexOf("--allowedTools") + 1].includes("Bash(rm viejo.txt)"));
  assert.ok(!a2[a2.indexOf("--allowedTools") + 1].split(",").includes("Bash"));
  assert.equal((await ctx.tasks.get(ctx.ownerId, t.id)).status, "hecha");
  const ap = (await ctx.audit.list(ctx.ownerId)).map((x) => x.action);
  assert.ok(ap.includes("aprobacion.pedida") && ap.includes("aprobacion.aprobada"));
});

test("acción peligrosa rechazada: no se ejecuta y la tarea queda 'rechazada'", async () => {
  const t = await ctx.direct.enqueue({ userId: ctx.ownerId, text: "borra todo" });
  const { w, out } = mkWorker("deny");
  const p = w.tick();
  await decideNext(false);
  await p;
  assert.equal(existsSync(`${out}.1.stdin`), false); // no hubo segunda ejecución
  assert.equal((await ctx.tasks.get(ctx.ownerId, t.id)).status, "rechazada");
});

test("la aprobación caduca según config", async () => {
  const a = await ctx.agent.requestApproval(ctx.ownerId, null, { kind: "borrar", summary: "x", detail: "" });
  const real = ctx.now;
  assert.equal((await ctx.agent.approvalStatus(ctx.ownerId, a.id)).status, "pendiente");
  const orig = ctx.permissions.aprobacion_caduca_minutos;
  ctx.permissions.aprobacion_caduca_minutos = -1;
  assert.equal((await ctx.agent.approvalStatus(ctx.ownerId, a.id)).status, "caducada");
  ctx.permissions.aprobacion_caduca_minutos = orig; void real;
});

test("tope diario: con el tope alcanzado /claim no entrega tareas", async () => {
  ctx.permissions.tope_claude = { ...ctx.permissions.tope_claude, diario_tareas: 1 };
  const t = await ctx.direct.enqueue({ userId: ctx.ownerId, text: "otra" });
  const r = await (await call("/api/agent/claim", { method: "POST", body: {}, tk: pcToken })).json();
  assert.equal(r.task, null);
  assert.equal(r.reason, "tope_diario");
  assert.equal((await ctx.tasks.get(ctx.ownerId, t.id)).status, "pendiente");
  const { w } = mkWorker("ok");
  assert.equal(await w.tick(), "tope_diario");
  ctx.permissions.tope_claude.diario_tareas = null;
});

test("tope por tarea: se detiene y queda 'tope_tarea'", async () => {
  ctx.permissions.tope_claude = { ...ctx.permissions.tope_claude, por_tarea_tokens: 1000, diario_tareas: null };
  // limpia lo pendiente para que la siguiente sea la de esta prueba
  while (await ctx.tasks.claim(ctx.ownerId)) { /* vaciar */ }
  const t = await ctx.direct.enqueue({ userId: ctx.ownerId, text: "grande" });
  const { w } = mkWorker("big");
  await w.tick();
  const fin = await ctx.tasks.get(ctx.ownerId, t.id);
  assert.equal(fin.status, "tope_tarea");
  ctx.permissions.tope_claude.por_tarea_tokens = null;
});

test("finish no acepta tareas que no están en curso", async () => {
  const t = await ctx.direct.enqueue({ userId: ctx.ownerId, text: "pendiente" });
  const r = await call(`/api/agent/tasks/${t.id}/finish`, { method: "POST", body: { status: "hecha" }, tk: pcToken });
  assert.equal(r.status, 409);
});

test("buildArgs: sin carpetas permitidas solo lee; con carpetas lee y escribe; nunca flags prohibidos", () => {
  const a = buildArgs({ task: { header: {} }, folders: [] });
  assert.equal(a[a.indexOf("--allowedTools") + 1], "Read,Glob,Grep");
  const b = buildArgs({ task: { header: {} }, folders: ["C:/a", "C:/b"] });
  assert.ok(b[b.indexOf("--allowedTools") + 1].includes("Edit"));
  assert.deepEqual(b.filter((x, i) => b[i - 1] === "--add-dir"), ["C:/b"]);
  for (const x of [a, b]) assert.ok(!x.includes("--dangerously-skip-permissions") && !x.includes("--bare"));
});

test("classifyDenial: borrar, git push, desplegar, terminal libre", () => {
  const k = (command) => classifyDenial({ tool_name: "Bash", tool_input: { command } }).kind;
  assert.equal(k("rm -rf build"), "borrar");
  assert.equal(k("del /s x"), "borrar");
  assert.equal(k("git push origin main"), "git_push");
  assert.equal(k("npm publish"), "desplegar");
  assert.equal(k("ls -la"), "terminal_libre");
});

void sha;
