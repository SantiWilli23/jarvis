// E2E del Modo Pro: servidor real de Jarvis (en memoria) + pro-worker REAL del desktop por HTTP,
// con claude/agy falsos (test/fixtures) sobre repos git temporales. Contrato: docs/PRO.md.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "../server/db/client.js";
import { buildContext } from "../server/context.js";
import { createApp } from "../server/app.js";
import { createHubClient } from "../desktop/runner/hub-client.js";
import { createProWorker } from "../desktop/runner/pro-worker.js";
import { createOutbox } from "../desktop/runner/outbox.js";

const fx = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const CLAUDE = { command: process.execPath, prefix: [join(fx, "fake-claude.mjs")] };
const AGY = { command: process.execPath, prefix: [join(fx, "fake-agy.mjs")] };
Object.assign(process.env, { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" });

let server, base, ctx, web, pc, root, repo, repoB, hub, worker, outbox;
const net = { drop: false, lose: false }; // drop: servidor "dormido"; lose: el servidor procesa pero la respuesta se pierde
const call = (path, { method = "GET", body, tk = web } = {}) =>
  fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), authorization: `Bearer ${tk}` }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, ...(await r.json()) }));

function mkRepo(name) {
  const d = join(root, name); mkdirSync(d);
  const g = (...a) => execFileSync("git", a, { cwd: d });
  g("init", "-q"); writeFileSync(join(d, "a.txt"), "uno\n"); g("add", "-A"); g("commit", "-qm", "base");
  return d;
}
const gitLog = (d) => execFileSync("git", ["log", "--format=%s"], { cwd: d }).toString().trim().split("\n");
const env = (o = {}) => {
  for (const k of ["FAKE_503", "FAKE_QUOTA", "FAKE_EDIT", "FAKE_CMD", "FAKE_RESULT"]) delete process.env[k];
  process.env.FAKE_OUT = join(mkdtempSync(join(tmpdir(), "e2e-out-")), "f");
  Object.assign(process.env, o); return process.env.FAKE_OUT;
};
const modelsUsed = (out) => {
  const r = [];
  for (let n = 0; existsSync(`${out}.${n}.args.json`); n++) { const a = JSON.parse(readFileSync(`${out}.${n}.args.json`, "utf8")); r.push(a[a.indexOf("--model") + 1]); }
  return r;
};
const INF = (files, res = "ok") => JSON.stringify({ dijo_hizo: ["hice cambios"], archivos_tocados: files, comandos: [], resultado: res });
const VER = (v = "aprobado") => JSON.stringify({ dijo_no_hizo: [], hizo_no_dijo: [], cambios_ajenos: [], veredicto: v });

const newThread = async (r = repo) => (await call("/api/pro/threads", { method: "POST", body: { repo: r } })).thread.id;
const say = (t, text) => call(`/api/pro/threads/${t}/messages`, { method: "POST", body: { text } });
const view = (t) => call(`/api/pro/threads/${t}`);
const roundOf = async (t, id) => (await view(t)).rounds.find((r) => r.id === id);
const decide = (rid, body) => call(`/api/pro/rounds/${rid}/decision`, { method: "POST", body });
const cancel = (rid) => call(`/api/pro/rounds/${rid}/cancel`, { method: "POST" });
const jobsOf = (rid) => ctx.pro.orch.store.jobsOfRound(rid);
const tick = (o = {}) => { env(o); return worker.tick(); };

before(async () => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), "e2e-pro-")));
  repo = mkRepo("app"); repoB = mkRepo("otro");
  ctx = await buildContext({ db: createDb({ url: ":memory:" }), env: { OWNER_PASSWORD: "x-123" } }); ctx.config.motores_pc.gemini.activo = true;
  ctx.permissions.carpetas_permitidas = [root];
  server = createServer(createApp(ctx));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  web = (await (await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "x-123" }) })).json()).token;
  pc = (await call("/api/devices", { method: "POST", body: { name: "PC", kind: "pc" } })).token;
  const fetchFn = async (url, init) => {
    const fin = /\/pro\/jobs\/\d+\/(report|fail)$/.test(url);
    if (net.drop && fin) return new Response(JSON.stringify({ error: "dormido" }), { status: 503 });
    const res = await fetch(url, init);
    if (net.lose && fin) throw new TypeError("fetch failed (respuesta perdida)");
    return res;
  };
  hub = createHubClient({ baseUrl: base, token: pc, fetchFn });
  outbox = createOutbox(mkdtempSync(join(tmpdir(), "e2e-box-")));
  // El worker solo permite `repo` (no `repoB`): sirve para el rechazo del lado del PC.
  worker = createProWorker({ hub, outbox, allowedFolders: () => [repo], claude: CLAUDE, agy: AGY, geminiActivo: () => true, geminiFolders: () => [dirname(repo)] });
  await hub.hello({ host: "pc-test", version: "t", capabilities: { claude: { ok: true, modelos: ["opus", "sonnet"] }, agy: { ok: true, login: "google" }, repos: [repo, repoB] } });
});
after(() => { server.close(); rmSync(root, { recursive: true, force: true }); });

test("(a) ronda feliz: plan, programar, verificar, aceptar y commit local", async () => {
  const t = await newThread();
  const r = (await say(t, "arregla el bug del servidor")).round;
  assert.equal(r.programmer, "claude");
  assert.equal(await tick({ FAKE_RESULT: "1. Crear nuevo.txt" }), "job");
  assert.equal((await roundOf(t, r.id)).status, "esperando_aprobacion");
  const plan = (await view(t)).messages.find((m) => m.kind === "plan");
  assert.equal(plan.text, "1. Crear nuevo.txt"); // texto, no un objeto de informe serializado
  assert.equal(await tick(), "vacio");
  await decide(r.id, { accion: "aprobar" });
  const out = env({ FAKE_EDIT: "nuevo.txt:hola", FAKE_RESULT: INF(["nuevo.txt"]) });
  assert.equal(await worker.tick(), "job");
  assert.deepEqual(modelsUsed(out), ["sonnet"]);
  assert.equal((await roundOf(t, r.id)).status, "verificando");
  const o2 = env({ FAKE_RESULT: VER() });
  assert.equal(await worker.tick(), "job"); // verifica el OTRO motor (agy)
  assert.deepEqual(modelsUsed(o2), ["gemini-3.8-flash-high"]);
  const st = await roundOf(t, r.id);
  assert.equal(st.status, "esperando_aprobacion"); assert.match(st.summary, /aprobado/);
  assert.ok(!gitLog(repo).some((l) => /Jarvis Pro/.test(l)));
  await decide(r.id, { accion: "aprobar" });
  assert.equal(await tick(), "job"); // commit local
  assert.equal((await roundOf(t, r.id)).status, "hecha");
  assert.match(gitLog(repo)[0], /^Jarvis Pro: arregla el bug/);
  assert.equal(readFileSync(join(repo, "nuevo.txt"), "utf8"), "hola");
  assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: repo }).toString().trim(), "");
  assert.equal(await tick(), "vacio");
});

test("(b)+(c) mentira detectada (dijo_no_hizo, hizo_no_dijo, cambios_ajenos) y tope de 2 correcciones", async () => {
  const t = await newThread();
  const r = (await say(t, "arregla el bug del login")).round;
  await tick({ FAKE_RESULT: "plan" });
  await decide(r.id, { accion: "aprobar" });
  const lies = [
    { FAKE_EDIT: "real.txt:1", FAKE_RESULT: INF(["fantasma.js"]) }, // dice fantasma.js, toca real.txt
    { FAKE_EDIT: ".env:K=1", FAKE_RESULT: INF(["real.txt"]) },      // dice real.txt, toca .env
    { FAKE_EDIT: "real.txt:2", FAKE_RESULT: INF(["fantasma.js"]) },
  ];
  for (let i = 0; i < 3; i++) {
    assert.equal(await tick(lies[i]), "job");                        // programar
    assert.equal(await tick({ FAKE_RESULT: VER("aprobado") }), "job"); // la IA aprueba; lo determinista no
    const st = await roundOf(t, r.id);
    if (i < 2) { assert.equal(st.status, "corrigiendo"); assert.equal(st.corrections, i + 1); }
    else { assert.equal(st.status, "necesita_usuario"); assert.equal(st.corrections, 2); }
  }
  const ver = (await view(t)).messages.filter((m) => m.kind === "verificacion").map((m) => m.text);
  assert.equal(ver.length, 3);
  assert.match(ver[0], /Dijo y no hizo[\s\S]*fantasma\.js/); assert.match(ver[0], /Hizo y no dijo[\s\S]*real\.txt/);
  assert.match(ver[1], /Cambios ajenos[\s\S]*\.env/); assert.match(ver[1], /Dijo y no hizo[\s\S]*real\.txt/);
  const vj = (await jobsOf(r.id)).find((j) => j.role === "verificar");
  const rep = (await call(`/api/pro/jobs/${vj.id}`)).report.body;
  assert.ok(rep.dijo_no_hizo.length && rep.hizo_no_dijo.length && rep.veredicto === "corregir");
  assert.equal(await tick(), "vacio"); // no hay cuarta corrección
  await cancel(r.id);
});

test("(d) agy: 503 al programar baja de modelo; sin cuota al planear no baja", async () => {
  const t = await newThread();
  const r = (await say(t, "mejora el css de la pantalla y los colores")).round;
  assert.equal(r.programmer, "gemini");
  const q = env({ FAKE_QUOTA: "1" });
  assert.equal(await worker.tick(), "job");
  assert.deepEqual(modelsUsed(q), ["gemini-3.8-flash-high"]); // un solo intento: no baja
  assert.equal((await roundOf(t, r.id)).status, "necesita_usuario");
  assert.match((await view(t)).messages.at(-1).text, /No cambio de modelo/);
  await decide(r.id, { accion: "corregir", text: "reintenta" }); // replanifica
  await tick({ FAKE_RESULT: "plan css" });
  assert.equal((await roundOf(t, r.id)).status, "esperando_aprobacion");
  await decide(r.id, { accion: "aprobar" });
  const o = env({ FAKE_503: "gemini-3.8-flash-medium", FAKE_EDIT: "estilo.css:a{}", FAKE_RESULT: INF(["estilo.css"]) });
  assert.equal(await worker.tick(), "job");
  assert.deepEqual(modelsUsed(o), ["gemini-3.8-flash-medium", "gemini-3.8-flash-low"]);
  assert.equal((await roundOf(t, r.id)).status, "verificando");
  const o2 = env({ FAKE_RESULT: VER() });
  await worker.tick();
  assert.deepEqual(modelsUsed(o2), ["opus"]); // verifica Claude
  await cancel(r.id);
});

test("(e) repo no permitido: lo rechazan el servidor y el PC", async () => {
  assert.equal((await call("/api/pro/threads", { method: "POST", body: { repo: join(tmpdir(), "no-declarado") } })).status, 422);
  const t = await newThread(repoB); // el servidor lo acepta, el PC no lo tiene en sus carpetas
  const r = (await say(t, "arregla el bug")).round;
  assert.equal(await tick({ FAKE_RESULT: "x" }), "job");
  const st = await roundOf(t, r.id);
  assert.equal(st.status, "fallida"); assert.match(st.summary, /repo_invalido/);
  // el servidor revalida al reclamar si cambian las carpetas permitidas
  const t2 = await newThread(repo);
  const r2 = (await say(t2, "arregla el bug 2")).round;
  ctx.permissions.carpetas_permitidas = [repoB];
  assert.equal(await tick(), "vacio");
  assert.equal((await roundOf(t2, r2.id)).status, "fallida");
  ctx.permissions.carpetas_permitidas = [root];
});

test("(f) buzón: servidor dormido y reenvío idempotente", async () => {
  const t = await newThread();
  const r = (await say(t, "arregla el bug del buzon")).round;
  net.drop = true;
  assert.equal(await tick({ FAKE_RESULT: "plan buzon" }), "job");
  assert.equal(outbox.list().length, 1);
  assert.equal((await roundOf(t, r.id)).status, "planeando"); // el servidor no se enteró
  assert.equal(await tick(), "vacio"); // sigue dormido: el buzón no se vacía
  assert.equal(outbox.list().length, 1);
  net.drop = false;
  assert.equal(await tick(), "vacio"); // despierta: el ciclo reenvía el buzón primero
  assert.equal(outbox.list().length, 0);
  assert.equal((await roundOf(t, r.id)).status, "esperando_aprobacion");
  const planJob = (await jobsOf(r.id))[0];
  const again = await hub.proReport(planJob.id, { informe: "otro", diff: "", usage: { tokens_in: 1, tokens_out: 1 } });
  assert.equal(again.duplicado, true);
  assert.equal((await view(t)).messages.filter((m) => m.kind === "plan").length, 1);
  // respuesta perdida: el servidor ya procesó el informe y el PC lo reenvía desde el buzón
  await decide(r.id, { accion: "aprobar" });
  net.lose = true;
  assert.equal(await tick({ FAKE_EDIT: "b.txt:1", FAKE_RESULT: INF(["b.txt"]) }), "job");
  assert.equal(outbox.list().length, 1);
  assert.equal((await roundOf(t, r.id)).status, "verificando");
  net.lose = false;
  await tick({ FAKE_RESULT: VER() }); // reenvía (duplicado) y luego verifica
  assert.equal(outbox.list().length, 0);
  assert.equal((await jobsOf(r.id)).filter((j) => j.role === "verificar").length, 1);
  assert.equal((await roundOf(t, r.id)).status, "esperando_aprobacion");
});
