import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createProWorker } from "../desktop/runner/pro-worker.js";
import { createOutbox } from "../desktop/runner/outbox.js";

const fx = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const CLAUDE = { command: process.execPath, prefix: [join(fx, "fake-claude.mjs")] };
const AGY = { command: process.execPath, prefix: [join(fx, "fake-agy.mjs")] };

function repo() {
  const d = mkdtempSync(join(tmpdir(), "pro-w-"));
  const g = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: d });
  g("init", "-q"); writeFileSync(join(d, "a.txt"), "uno\n"); g("add", "-A"); g("commit", "-qm", "base");
  return d;
}
function setup(env = {}) {
  const out = join(mkdtempSync(join(tmpdir(), "pro-out-")), "f");
  for (const k of ["FAKE_503", "FAKE_QUOTA", "FAKE_EDIT", "FAKE_CMD", "FAKE_RESULT"]) delete process.env[k];
  Object.assign(process.env, { FAKE_OUT: out, GEMINI_API_KEY: "secreta", ...env });
  return out;
}
const job = (r, o = {}) => ({ id: 1, round_id: 1, role: "programar", engine: "claude", model: "sonnet", repo: r, mode: "editar", prompt: "haz algo", timeout_s: 60, ...o });
function mkHub(extra = {}) {
  const h = { reports: [], fails: [], events: [], jobs: [], ...extra };
  h.proClaim = async () => ({ job: h.jobs.shift() || null });
  h.proEvents = async (id, ev) => { h.events.push(...ev); };
  h.proReport = async (id, b) => { if (h.down) throw Object.assign(new Error("HTTP 503"), { status: 503 }); h.reports.push({ id, ...b }); };
  h.proFail = async (id, e) => { if (h.down) throw Object.assign(new Error("HTTP 503"), { status: 503 }); h.fails.push({ id, e }); };
  return h;
}
const worker = (hub, r, o = {}) => createProWorker({ hub, allowedFolders: () => [r], claude: CLAUDE, agy: AGY, ...o });
const args = (out, n = 0) => JSON.parse(readFileSync(`${out}.${n}.args.json`, "utf8"));
const flag = (a, f) => a[a.indexOf(f) + 1];
const clean = (...ds) => ds.forEach((d) => rmSync(d, { recursive: true, force: true }));

test("plan con Claude: opus, solo lectura, sin diff", async () => {
  const r = repo(), out = setup(); const hub = mkHub(); hub.jobs.push(job(r, { role: "planear", model: "opus", mode: "solo_lectura" }));
  assert.equal(await worker(hub, r).tick(), "job");
  const a = args(out);
  assert.equal(flag(a, "--model"), "opus"); assert.equal(flag(a, "--permission-mode"), "default");
  assert.match(flag(a, "--disallowedTools"), /Edit/);
  assert.equal(hub.reports.length, 1); assert.equal(hub.reports[0].diff, ""); clean(r);
});

test("programar con Claude: sonnet acceptEdits y diff real", async () => {
  const r = repo(), out = setup({ FAKE_EDIT: "nuevo.txt:hola", FAKE_RESULT: JSON.stringify({ dijo_hizo: ["creé nuevo.txt"], archivos_tocados: ["nuevo.txt"], resultado: "ok" }) });
  const hub = mkHub(); hub.jobs.push(job(r));
  await worker(hub, r).tick();
  const a = args(out); assert.equal(flag(a, "--permission-mode"), "acceptEdits"); assert.equal(flag(a, "--model"), "sonnet");
  const rep = hub.reports[0]; assert.match(rep.diff, /nuevo\.txt/); assert.notEqual(rep.tree_before, rep.tree_after);
  assert.deepEqual(rep.informe.archivos_tocados, ["nuevo.txt"]); clean(r);
});

test("agy: sin GEMINI_API_KEY, 503 baja de modelo y programa", async () => {
  const r = repo(), out = setup({ FAKE_503: "gemini-3.8-flash-high", FAKE_EDIT: "x.txt:1" });
  const hub = mkHub(); hub.jobs.push(job(r, { engine: "gemini", model: "gemini-3.8-flash-high" }));
  await worker(hub, r).tick();
  assert.equal(flag(args(out, 0), "--model"), "gemini-3.8-flash-high");
  assert.equal(flag(args(out, 1), "--model"), "gemini-3.8-flash-medium");
  assert.equal(JSON.parse(readFileSync(`${out}.1.env.json`, "utf8")).GEMINI_API_KEY, null);
  assert.match(hub.reports[0].diff, /x\.txt/); assert.ok(existsSync(join(r, "x.txt")));
  clean(r);
});

test("agy: sin cuota falla con sin_cuota y NO baja de modelo", async () => {
  const r = repo(), out = setup({ FAKE_QUOTA: "1" });
  const hub = mkHub(); hub.jobs.push(job(r, { role: "planear", engine: "gemini", model: "gemini-3.8-flash-high", mode: "solo_lectura" }));
  await worker(hub, r).tick();
  assert.deepEqual(hub.fails, [{ id: 1, e: "sin_cuota" }]); assert.ok(!existsSync(`${out}.1.args.json`));
  const o2 = setup({ FAKE_QUOTA: "1" }); const h2 = mkHub(); h2.jobs.push(job(r, { engine: "gemini", model: "gemini-3.8-flash-high" }));
  await worker(h2, r).tick(); assert.equal(h2.fails[0].e, "sin_cuota"); assert.ok(!existsSync(`${o2}.1.args.json`));
  clean(r);
});

test("agy: comando peligroso se bloquea", async () => {
  const r = repo(); setup({ FAKE_CMD: "git push origin main" });
  const hub = mkHub(); hub.jobs.push(job(r, { engine: "gemini", model: "gemini-3.8-flash-high" }));
  await worker(hub, r).tick(); assert.match(hub.fails[0].e, /comando_bloqueado: git_push/); clean(r);
});

test("repo fuera de carpetas permitidas o no git se rechaza", async () => {
  const r = repo(), otro = repo(), plain = mkdtempSync(join(tmpdir(), "pro-plain-")); setup();
  const hub = mkHub(); hub.jobs.push(job(otro), job(plain, { id: 2 }));
  const w = createProWorker({ hub, allowedFolders: () => [r, plain], claude: CLAUDE, agy: AGY });
  await w.tick(); await w.tick();
  assert.deepEqual(hub.fails.map((f) => f.e), ["repo_invalido", "repo_invalido"]);
  clean(r, otro, plain);
});

test("outbox reenvía el informe cuando el servidor vuelve", async () => {
  const r = repo(), box = mkdtempSync(join(tmpdir(), "pro-box-")); setup({ FAKE_EDIT: "z.txt:1" });
  const hub = mkHub({ down: true }); hub.jobs.push(job(r));
  const outbox = createOutbox(box); const w = worker(hub, r, { outbox });
  await w.tick();
  assert.equal(hub.reports.length, 0); assert.equal(outbox.list().length, 1);
  hub.down = false; await w.tick(); // el siguiente ciclo vacía el buzón
  assert.equal(hub.reports.length, 1); assert.equal(outbox.list().length, 0); assert.match(hub.reports[0].diff, /z\.txt/);
  assert.equal(await outbox.flush(async () => { throw new Error("no debe llamarse"); }), 0);
  clean(r, box);
});
