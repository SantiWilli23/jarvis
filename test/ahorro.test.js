// Ahorro de uso de Claude (docs/NAV.md): argumentos, entorno, medida, topes y respuestas guardadas. Sin red ni Claude real.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { buildNavArgs, buildArgs, buildProArgs } from "../desktop/runner/claude-args.js";
import { buildDescribeArgs } from "../desktop/runner/pc-capture.js";
import { navPrompt } from "../desktop/runner/nav-worker.js";
import { runClaude, entornoLimpio } from "../desktop/runner/claude-runner.js";
import { probeClaudeModel, limpiarCacheSonda } from "../desktop/runner/doctor.js";
import { createDb } from "../server/db/client.js";
import { initSchema } from "../server/db/index.js";
import { buildContext, loadJson } from "../server/context.js";
import { clock } from "./helpers.js";

const flag = (a, f) => a[a.indexOf(f) + 1];
const TODO = loadJson("nav.json").ahorro;
const tarea = (o = {}) => ({ id: 1, tipo: "preguntar_ia", sitio: "chatgpt", consulta: "x", url_inicial: "https://chatgpt.com/", limites: { hosts: ["chatgpt.com"] }, ...o });

test("nav: con ahorro no hay ToolSearch; sin él, todo como antes", () => {
  const a = buildNavArgs({ perfil: "ia", ahorro: TODO, presupuesto: 0.2 });
  assert.equal(flag(a, "--tools"), "");
  assert.ok(!a.includes("--allowedTools") && !a.includes("--append-system-prompt"));
  assert.match(flag(a, "--system-prompt"), /No escribas ningún texto/);
  assert.equal(flag(a, "--max-budget-usd"), "0.2");
  assert.ok(flag(a, "--disallowedTools").split(",").includes("ToolSearch"));
  const viejo = buildNavArgs({ perfil: "ia" });
  assert.equal(flag(viejo, "--tools"), "ToolSearch");
  assert.ok(viejo.includes("--append-system-prompt") && !viejo.includes("--max-budget-usd"));
  assert.ok(!navPrompt(tarea({ ahorro: TODO })).includes("select:"));
  assert.match(navPrompt(tarea({ ahorro: TODO })), /botón Detener/);
  assert.match(navPrompt(tarea()), /select:/);
  assert.match(navPrompt(tarea({ ahorro: TODO, tipo: "memoria_repartir", perfil: "ia" })), /sin cambiar ni un carácter/);
});

test("Clásico, Pro y capturas: sin MCP ni skills del usuario", () => {
  for (const a of [buildArgs({ task: { header: {} } }), buildProArgs({ role: "planear", repo: "r" }), buildDescribeArgs()]) {
    assert.ok(a.includes("--strict-mcp-config") && a.includes("--disable-slash-commands"));
  }
});

test("entorno limpio: fuera lo de Claude Desktop, queda la sesión", () => {
  const e = entornoLimpio({ PATH: "p", CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "claude-desktop", CLAUDE_AGENT_SDK_VERSION: "1", CLAUDE_CONFIG_DIR: "d", CLAUDE_CODE_GIT_BASH_PATH: "b" });
  assert.deepEqual(Object.keys(e).sort(), ["CLAUDE_CODE_GIT_BASH_PATH", "CLAUDE_CONFIG_DIR", "PATH"]);
});

test("runClaude: guarda costo y uso del mensaje result; tope de presupuesto con su motivo", async () => {
  const spawnFn = (msg) => () => {
    const c = new EventEmitter(); c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.stdin = new PassThrough();
    setImmediate(() => { c.stdout.write(JSON.stringify(msg) + "\n"); setImmediate(() => c.emit("close", 0)); });
    return c;
  };
  const r = await runClaude({ command: "c", args: [], stdin: "x", spawnFn: spawnFn({ type: "result", subtype: "error_max_budget_usd", is_error: true, total_cost_usd: 0.21, usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 } }) });
  assert.deepEqual(r.costo, { costo_usd: 0.21, entrada: 1, salida: 2, cache_lectura: 3, cache_escritura: 4 });
  assert.equal(r.errorKind, "tope_costo_tarea");
});

test("doctor: la sonda dura 24 h, sin guardar sesión y con caché de 5 min", async () => {
  limpiarCacheSonda();
  let n = 0, t = 0, visto;
  const ex = async (_b, args, _t, env) => { n++; visto = { args, env }; return JSON.stringify({ is_error: false }); };
  const sonda = () => probeClaudeModel({ command: "c" }, "m", { ex, env: {}, now: () => t });
  await sonda(); t = 23 * 3_600_000; await sonda();
  assert.equal(n, 1);
  assert.ok(visto.args.includes("--no-session-persistence"));
  assert.equal(visto.env.CLAUDE_CODE_PROMPT_CACHE_TTL, "5m");
  t = 25 * 3_600_000; await sonda();
  assert.equal(n, 2);
  limpiarCacheSonda();
});

const now = clock();
let ctx, uid;
before(async () => {
  const db = createDb({ url: ":memory:" });
  await initSchema(db);
  ctx = await buildContext({ db, env: { OWNER_PASSWORD: "prueba-123" }, now });
  uid = ctx.ownerId;
  await ctx.agent.hello(uid, { capabilities: { chrome: { ok: true } } });
});
after(() => {});

const pedir = (o = {}) => ctx.nav.enqueue({ userId: uid, tipo: "preguntar_ia", sitio: "chatgpt", consulta: "qué es un púlsar", ...o });
async function responder(usd = 0.08) {
  const { task } = await ctx.nav.claim(uid, 1);
  await ctx.nav.result(uid, 1, task.id, { estado: "ok", respuesta: "Una estrella.", uso: { costo_usd: usd, entrada: 1, salida: 2, cache_lectura: 3, cache_escritura: 4 } });
  return task;
}

test("servidor: el claim lleva ajustes, el gasto se suma y la consulta repetida sale guardada", async () => {
  const primero = await pedir();
  const task = await responder();
  assert.deepEqual([task.limites.max_budget_usd, task.limites.modelo], [0.2, "sonnet"]);
  assert.deepEqual(task.ahorro, TODO);
  assert.equal((await ctx.status(uid)).uso_navegador.costo_dia, 0.08);
  const otra = await pedir();
  assert.equal(otra.guardada, true);
  assert.notEqual(otra.id, primero.id);
  assert.match((await ctx.nav.ver(uid, otra.id)).task.respuesta, /^\(respuesta guardada\)\nUna estrella\./);
  for (const o of [{ nuevo: true }, { text: "pregúntale a ChatGPT qué es un púlsar de nuevo" }]) {
    const r = await pedir(o);
    assert.ok(!r.guardada);
    await ctx.nav.cancel(uid, r.id);
  }
  const ajeno = await ctx.nav.enqueue({ userId: uid + 1, tipo: "preguntar_ia", sitio: "chatgpt", consulta: "qué es un púlsar" });
  assert.ok(!ajeno.guardada, "nunca entre usuarios");
  await ctx.nav.cancel(uid + 1, ajeno.id);
});

test("servidor: tope de gasto del día", async () => {
  await pedir({ consulta: "otra cosa" });
  await responder(5);
  await assert.rejects(pedir({ consulta: "una más" }), (e) => e.error === "tope_costo");
});
