// Estabilidad del Modo Pro: errores de Claude, reserva de modelo, cancelación, vacíos, commit por rutas y doctor.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createProWorker } from "../desktop/runner/pro-worker.js";
import { classifyClaudeError, claudeEnv } from "../desktop/runner/claude-runner.js";
import { commitPaths, snapshot } from "../desktop/runner/git-snapshot.js";
import { probeClaudeModel, limpiarCacheSonda, runDoctor } from "../desktop/runner/doctor.js";
import { buildProArgs } from "../desktop/runner/claude-args.js";
import { modelChain } from "../desktop/runner/agy-args.js";
import { classifyAgyError } from "../desktop/runner/agy-runner.js";
import { redact } from "../server/pro/redact.js";
import { commitPathsOf } from "../server/pro/check.js";
import { proReasons, proNotices } from "../server/pro/reasons.js";

const fx = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const CLAUDE = { command: process.execPath, prefix: [join(fx, "fake-claude.mjs")] };
const OPUS = "claude-opus-5-5", SONNET = "claude-sonnet-5-5";
const limpia = (...ds) => ds.forEach((d) => rmSync(d, { recursive: true, force: true }));

function repo() {
  const d = mkdtempSync(join(tmpdir(), "pro-e-"));
  const g = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: d });
  g("init", "-q"); g("config", "user.name", "t"); g("config", "user.email", "t@t"); writeFileSync(join(d, "a.txt"), "uno\n"); writeFileSync(join(d, "otro.txt"), "x\n"); g("add", "-A"); g("commit", "-qm", "base");
  return { d, g };
}
function setup(env = {}) {
  for (const k of ["FAKE_EDIT", "FAKE_RESULT", "FAKE_ERR_MODEL", "FAKE_ERR_TEXT", "FAKE_EMPTY", "FAKE_SLEEP_MS"]) delete process.env[k];
  const out = join(mkdtempSync(join(tmpdir(), "pro-eo-")), "f");
  Object.assign(process.env, { FAKE_OUT: out, ...env });
  return out;
}
function mkHub(extra = {}) {
  const h = { reports: [], fails: [], events: [], jobs: [], ...extra };
  h.proClaim = async () => ({ job: h.jobs.shift() || null });
  h.proEvents = h.proEvents || (async (id, ev) => { h.events.push(...ev); });
  h.proReport = async (id, b) => { h.reports.push({ id, ...b }); };
  h.proFail = async (id, e) => { h.fails.push({ id, e }); };
  return h;
}
const job = (r, o = {}) => ({ id: 1, round_id: 1, role: "planear", engine: "claude", model: OPUS, repo: r, mode: "solo_lectura", prompt: "plan", timeout_s: 60, ...o });
const worker = (hub, r, o = {}) => createProWorker({ hub, allowedFolders: () => [r], claude: CLAUDE, geminiActivo: () => false, geminiFolders: () => [], cancelPollMs: 0, ...o });
const args0 = (out, n) => JSON.parse(readFileSync(`${out}.${n}.args.json`, "utf8"));

test("classifyClaudeError: modelo, cuota, login y saturación", () => {
  assert.equal(classifyClaudeError("There is an issue with the selected model (x). It may not exist or you may not have access to it"), "modelo_no_disponible");
  assert.equal(classifyClaudeError("Claude usage limit reached"), "sin_cuota");
  assert.equal(classifyClaudeError("Invalid API key - Please run /login"), "sin_login");
  assert.equal(classifyClaudeError("API Error: 529 overloaded_error"), "saturado");
  assert.equal(classifyClaudeError("todo bien"), null);
});

test("claudeEnv quita claves de API y proveedores alternativos", () => {
  const e = claudeEnv({ ANTHROPIC_API_KEY: "k", CLAUDE_CODE_USE_BEDROCK: "1", ANTHROPIC_BASE_URL: "u", PATH: "p" });
  assert.deepEqual(Object.keys(e), ["PATH"]);
});

test("buildProArgs: --fallback-model solo si es otro modelo", () => {
  assert.equal(buildProArgs({ role: "planear", model: OPUS, repo: "r", fallbackModel: SONNET }).includes("--fallback-model"), true);
  assert.equal(buildProArgs({ role: "planear", model: SONNET, repo: "r", fallbackModel: SONNET }).includes("--fallback-model"), false);
});

test("modelChain usa los modelos de reserva que manda el servidor", () => {
  assert.deepEqual(modelChain("programar", "gemini-3.8-flash-medium", ["gemini-3.8-flash-low"]), ["gemini-3.8-flash-medium", "gemini-3.8-flash-low"]);
  assert.equal(modelChain("planear", "gemini-3.8-flash-high", ["x"]).length, 1);
});

test("classifyAgyError: solo mira el error del motor", () => {
  assert.equal(classifyAgyError("HTTP 429 quota exceeded"), "sin_cuota");
  assert.equal(classifyAgyError("todo bien"), null);
});

test("redact: secretos largos sí; hashes y nombres de código no", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  assert.ok(redact(`commit ${sha}`).includes(sha));
  assert.ok(redact("la función renderMensajeDeLaRondaActual falla").includes("renderMensajeDeLaRondaActual"));
  assert.ok(redact("clave Xk9fQ2mL8zP4vB7nR3tY6wH1sD5gJ0cA").includes("[SECRETO]"));
});

test("reasons: Pro funciona con solo Claude; Gemini va como aviso", () => {
  const cfg = { requisitos: { claude_modelos: [OPUS, SONNET] } };
  const caps = { claude: { ok: true, modelos: [OPUS, SONNET] }, repos: ["C:/r"] };
  assert.deepEqual(proReasons({ pcOnline: true, caps, cfg }), []);
  assert.ok(proNotices({ caps, geminiActivo: false, geminiFolders: [] }).includes("gemini_apagado"));
  assert.deepEqual(proReasons({ pcOnline: true, caps: { ...caps, claude: { ok: false, error: "modelo_no_disponible", faltan: [OPUS], modelos: [SONNET] } }, cfg }), ["claude_modelo_no_disponible"]);
});

test("commitPathsOf incluye el origen de los renombrados", () => {
  assert.deepEqual(commitPathsOf("R100\tviejo.js\tnuevo.js\nM\tb.js\n").sort(), ["b.js", "nuevo.js", "viejo.js"]);
});

test("worker: Opus sin cuota -> sigue con Sonnet y lo declara (modelo_real + fallback)", async () => {
  const { d } = repo(); const out = setup({ FAKE_ERR_MODEL: OPUS, FAKE_ERR_TEXT: "Claude usage limit reached" });
  const hub = mkHub(); hub.jobs.push(job(d, { fallback_models: [SONNET] }));
  await worker(hub, d).tick();
  assert.equal(hub.fails.length, 0); assert.equal(hub.reports.length, 1);
  assert.equal(hub.reports[0].fallback.motivo, "sin_cuota"); assert.equal(hub.reports[0].fallback.a, SONNET);
  assert.match(hub.reports[0].modelo_real, new RegExp(SONNET));
  assert.ok(args0(out, 1).includes(SONNET)); limpia(d);
});

test("worker: modelo inexistente sin reserva -> falla con modelo_no_disponible", async () => {
  const { d } = repo(); setup({ FAKE_ERR_MODEL: SONNET, FAKE_ERR_TEXT: "issue with the selected model. It may not exist or you may not have access" });
  const hub = mkHub(); hub.jobs.push(job(d, { role: "programar", model: SONNET, mode: "editar" }));
  await worker(hub, d).tick();
  assert.match(hub.fails[0].e, /^modelo_no_disponible:/); limpia(d);
});

test("worker: respuesta vacía del plan -> respuesta_vacia (no se aprueba un plan en blanco)", async () => {
  const { d } = repo(); setup({ FAKE_EMPTY: "1" });
  const hub = mkHub(); hub.jobs.push(job(d));
  await worker(hub, d).tick();
  assert.equal(hub.fails[0].e, "respuesta_vacia"); assert.equal(hub.reports.length, 0); limpia(d);
});

test("worker: el usuario cancela -> se detiene el proceso y no hay report ni fail", async () => {
  const { d } = repo(); setup({ FAKE_SLEEP_MS: "4000" });
  const hub = mkHub({ proEvents: async () => ({ ok: true, cancelado: true }) }); hub.jobs.push(job(d));
  const t0 = Date.now();
  await worker(hub, d, { cancelPollMs: 50 }).tick();
  assert.ok(Date.now() - t0 < 3500, "debe cortar antes de que el proceso termine solo");
  assert.equal(hub.reports.length, 0); assert.equal(hub.fails.length, 0); limpia(d);
});

test("commitPaths: solo los archivos de la ronda; lo demás del usuario queda sin tocar", async () => {
  const { d, g } = repo();
  writeFileSync(join(d, "otro.txt"), "cambio del usuario\n"); // ya estaba sucio antes de la ronda
  const base = await snapshot(d);
  writeFileSync(join(d, "nuevo.txt"), "de la ronda\n");
  const after = await snapshot(d);
  const c = await commitPaths(d, "ronda", ["nuevo.txt"], { expectedTree: after, baseTree: base });
  assert.ok(c.commit);
  const show = g("show", "--stat", "--format=", "HEAD").toString();
  assert.match(show, /nuevo\.txt/); assert.doesNotMatch(show, /otro\.txt/);
  assert.match(g("status", "--porcelain").toString(), /otro\.txt/);
  limpia(d);
});

test("commitPaths: se niega si un archivo de la ronda ya tenía cambios o cambió después", async () => {
  const { d } = repo();
  writeFileSync(join(d, "a.txt"), "del usuario\n"); const base = await snapshot(d);
  writeFileSync(join(d, "a.txt"), "de la ronda\n"); const after = await snapshot(d);
  await assert.rejects(commitPaths(d, "x", ["a.txt"], { expectedTree: after, baseTree: base }), (e) => e.code === "cambios_ajenos");
  const { d: d2 } = repo(); const b2 = await snapshot(d2);
  writeFileSync(join(d2, "a.txt"), "ronda\n"); const a2 = await snapshot(d2);
  writeFileSync(join(d2, "a.txt"), "editado despues\n");
  await assert.rejects(commitPaths(d2, "x", ["a.txt"], { expectedTree: a2, baseTree: b2 }), (e) => e.code === "cambios_ajenos");
  limpia(d, d2);
});

test("doctor: sonda real; un modelo que la cuenta no tiene deja claude.ok en false", async () => {
  limpiarCacheSonda();
  const ex = async (b, args) => {
    if (args.includes("--version")) return "2.1.323";
    if (args[args.indexOf("--model") + 1] === OPUS) return JSON.stringify({ is_error: true, result: "There is an issue with the selected model (x). It may not exist or you may not have access to it" });
    return JSON.stringify({ is_error: false, result: "ok" });
  };
  const r = await runDoctor({ exec: ex, claudePath: "c.exe", claudeModelos: [OPUS, SONNET] });
  assert.equal(r.claude.ok, false); assert.deepEqual(r.claude.modelos, [SONNET]); assert.deepEqual(r.claude.faltan, [OPUS]); assert.equal(r.claude.error, "modelo_no_disponible");
  let n = 0; limpiarCacheSonda();
  const p1 = await probeClaudeModel({ command: "c" }, SONNET, { ex: async () => { n++; return JSON.stringify({ is_error: false }); } });
  await probeClaudeModel({ command: "c" }, SONNET, { ex: async () => { n++; return "{}"; } });
  assert.equal(p1.ok, true); assert.equal(n, 1, "la segunda sonda sale de la caché");
});
