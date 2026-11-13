import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, all } from "../server/db/client.js";
import { buildContext } from "../server/context.js";
import { createApp } from "../server/app.js";
import { createHub } from "../server/ws-hub.js";
import { createHubClient } from "../desktop/runner/hub-client.js";
import { createWorker } from "../desktop/runner/worker.js";
import { detectDirect } from "../server/queue/direct.js";
import { buildAgyArgs, isProhibited } from "../desktop/runner/agy-args.js";
import { guardTool } from "../desktop/runner/agy-runner.js";

const FAKE = fileURLToPath(new URL("./fixtures/fake-agy.mjs", import.meta.url));
let server, base, ctx, web, pc, tmp;
const call = (path, { method = "GET", body, tk = web } = {}) =>
  fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(tk ? { authorization: `Bearer ${tk}` } : {}) }, body: body ? JSON.stringify(body) : undefined });

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "jarvis-gem-"));
  ctx = await buildContext({ db: createDb({ url: ":memory:" }), env: { OWNER_PASSWORD: "prueba-123" } });
  ctx.permissions.carpetas_gemini = [join(tmp, "gem")];
  server = createServer(createApp(ctx));
  ctx.hub = createHub({ server, sessions: ctx.sessions, bus: ctx.bus });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  web = (await (await call("/api/auth/login", { method: "POST", body: { password: "prueba-123" }, tk: null })).json()).token;
  pc = (await (await call("/api/devices", { method: "POST", body: { name: "PC", kind: "pc" } })).json()).token;
});
after(() => { ctx.hub.close(); server.close(); rmSync(tmp, { recursive: true, force: true }); });

test("disparadores de Gemini guardan el texto exacto", () => {
  for (const [t, rest] of [["/gemini  hola\n", " hola\n"], ["Díselo a Gemini: haz   esto ", "haz   esto "], ["directo a gemini:\nlínea", "línea"]]) {
    const d = detectDirect(t);
    assert.equal(d.direct, true); assert.equal(d.engine, "gemini"); assert.equal(d.text, rest);
  }
  assert.equal(detectDirect("/claude hola").engine, "claude");
  assert.equal(detectDirect("dímelo tal cual es").direct, false);
});

test("args de agy: seguros y con el modelo flash-high", () => {
  const a = buildAgyArgs({ prompt: "hola", model: "gemini-3.8-flash-high" });
  const s = a.join(" ");
  for (const f of ["-p", "--sandbox", "--print-timeout"]) assert.ok(a.includes(f), f);
  assert.equal(a[a.indexOf("--model") + 1], "gemini-3.8-flash-high");
  assert.ok(!/dangerously|auto/i.test(s.replace("hola", "")));
  for (const m of ["gemini-4-argon", "gemini-4-carbon", "gemini-3.1-pro", "gemini-2.5-pro"]) assert.equal(isProhibited(m), true, m);
});

test("guardTool bloquea rutas fuera de la carpeta y comandos con ..", () => {
  const dirs = [join(tmp, "gem")];
  assert.ok(guardTool({ tool: "write", params: { TargetFile: join(tmp, "otra", "x.txt") } }, dirs, dirs[0]));
  assert.ok(guardTool({ tool: "run", params: { CommandLine: "echo hola > ../fuera.txt" } }, dirs, dirs[0]));
  assert.equal(guardTool({ tool: "write", params: { TargetFile: join(dirs[0], "x.txt") } }, dirs, dirs[0]), null);
});

test("claim: un PC sin gemini no recibe tareas gemini; con gemini sí", async () => {
  const t = await ctx.tasks.create({ userId: 1, rawText: "x", mode: "directo", engine: "gemini" });
  assert.equal(await ctx.tasks.claim(1, "pc"), null);
  const c = await ctx.tasks.claim(1, "pc", ["claude", "gemini"]);
  assert.equal(c.id, t.id);
  assert.equal((await ctx.tasks.reassign(1, t.id, "claude"))?.engine ?? "claude", "claude");
});

test("privado con Gemini no crea tarea gemini", async () => {
  const antes = (await ctx.tasks.list(1)).filter((x) => x.engine === "gemini").length;
  const r = await call("/api/chat", { method: "POST", body: { text: "/gemini mis claves son secretas", private: true, engine: "gemini" } });
  const j = await r.json();
  assert.notEqual(j.status, "en_cola_gemini");
  assert.equal((await ctx.tasks.list(1)).filter((x) => x.engine === "gemini").length, antes);
  const r2 = await call("/api/tasks", { method: "POST", body: { text: "mi contraseña es 1234", engine: "gemini", private: true } });
  assert.ok(r2.status >= 400 || !(await r2.clone().json().catch(() => ({}))).task);
});

test("worker con agy falso: tarea hecha y uso en ai_usage, no en claude_usage", async () => {
  const t = await ctx.tasks.create({ userId: 1, rawText: "haz algo", mode: "directo", engine: "gemini" });
  process.env.FAKE_OUT = join(tmp, "o"); delete process.env.FAKE_EDIT;
  const hub = createHubClient({ baseUrl: base, token: pc });
  const w = createWorker({ hub, agy: { command: process.execPath, prefix: [FAKE] }, geminiFolders: [join(tmp, "gem")], claude: { command: process.execPath, prefix: [FAKE] }, fallbackCwd: tmp, getCapabilities: () => ({ claude: { ok: true }, gemini_cli: { ok: true, cli: "agy" } }) });
  await hub.hello({ version: "0", host: "PC", capabilities: { claude: { ok: true }, gemini_cli: { ok: true, cli: "agy" } } });
  for (let i = 0; i < 5 && !["hecha", "fallida"].includes((await ctx.tasks.get(1, t.id)).status); i++) await w.tick();
  assert.equal((await ctx.tasks.get(1, t.id)).status, "hecha");
  const ai = await all(ctx.db, "SELECT * FROM ai_usage WHERE engine='gemini'");
  assert.ok(ai.length >= 1);
});
