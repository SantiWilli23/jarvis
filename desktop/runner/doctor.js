// Diagnóstico del PC para el Modo Pro: ¿están Claude Code y Antigravity CLI (agy)? ¿hay login? ¿qué repos?
// Resultado = `capabilities` de hello/heartbeat (docs/PRO.md §8 + "Ampliaciones P3").
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readdirSync } from "node:fs";
import { join, delimiter } from "node:path";
import { homedir } from "node:os";
import { resolveClaude, claudeEnv, classifyClaudeError } from "./claude-runner.js";
import { PRO_MODELOS } from "./claude-args.js";
import { FLAGS_USADOS, versionOk, VERSION_MINIMA, MODELO_PLAN_DEFECTO, CADENA_PROGRAMAR } from "./agy-args.js";
import { resolveAgy } from "./agy-runner.js";
import { isGitRepo } from "./git-snapshot.js";

const run = promisify(execFile);

export { resolveAgy };

async function exec(b, args, timeout = 15000, baseEnv = process.env) {
  const p = run(b.command, [...b.prefix, ...args], { timeout, windowsHide: true, maxBuffer: 4_000_000, env: { ...baseEnv, ...(b.prefix.length && process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) } });
  p.child.stdin?.end(); // stdin cerrado: agy no debe quedarse esperando
  const { stdout, stderr } = await p;
  return `${stdout}\n${stderr}`;
}

// Comprueba con `agy --help` que existan los flags que usamos. { ok, missing[] }.
export async function verifyAgyFlags(b, exec_ = exec) {
  try { const h = await exec_(b, ["--help"]); const missing = FLAGS_USADOS.filter((f) => !h.includes(f)); return { ok: !missing.length, missing }; }
  catch (e) { return { ok: false, missing: FLAGS_USADOS, error: e.message }; }
}

// `agy models` funciona solo con sesión iniciada: lista "id<TAB>nombre" por línea (tras "Fetching available models...").
export function parseAgyModels(text) {
  return String(text || "").split(/\r?\n/).filter((l) => l.includes("\t")).map((l) => l.split("\t")[0].trim()).filter((id) => /^[\w.-]+$/.test(id));
}
export async function agyModels(b, exec_ = exec) {
  try { return parseAgyModels(await exec_(b, ["models"], 45000)); } catch { return []; }
}
export const listAgyModels = agyModels;

export async function discoverRepos(folders = [], isGit = isGitRepo) {
  const out = [];
  for (const f of folders.filter(Boolean)) {
    if (await isGit(f)) out.push(f);
    let kids = []; try { kids = readdirSync(f, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules"); } catch { /* sin acceso */ }
    for (const d of kids) { const p = join(f, d.name); if (existsSync(join(p, ".git")) && await isGit(p)) out.push(p); }
  }
  return [...new Set(out)];
}

// Sonda REAL de un modelo de Claude: una llamada mínima (sin herramientas ni MCP, ~1,6k tokens) con el id exacto.
// Una cuenta sin acceso al modelo contesta is_error (404) aunque el proceso salga bien. Resultado en caché:
// éxito 30 min, fallo 2 min (para no gastar cuota ni retrasar el hello).
const SONDA_OK_MS = 30 * 60_000, SONDA_FALLO_MS = 2 * 60_000;
const cacheSonda = new Map();
export function limpiarCacheSonda() { cacheSonda.clear(); }
export async function probeClaudeModel(cb, id, { ex = exec, env = process.env, now = Date.now } = {}) {
  const k = `${cb.command}|${id}`, c = cacheSonda.get(k);
  if (c && now() - c.at < (c.ok ? SONDA_OK_MS : SONDA_FALLO_MS)) return c.r;
  const args = ["-p", "ok", "--model", id, "--max-turns", "1", "--output-format", "json", "--system-prompt", "Responde ok.", "--tools", "", "--strict-mcp-config", "--disable-slash-commands"];
  let r;
  try {
    const out = await ex(cb, args, 60000, claudeEnv(env));
    const j = JSON.parse(String(out).trim().split(/\r?\n/).filter((l) => l.trim().startsWith("{")).pop() || "{}");
    r = j.is_error ? { ok: false, error: classifyClaudeError(j.result) || "error", detalle: String(j.result || "").slice(0, 160) } : { ok: true };
  } catch (e) {
    let j = null; try { j = JSON.parse(String(e.stdout || "").trim().split(/\r?\n/).filter((l) => l.trim().startsWith("{")).pop() || "null"); } catch { /* no era JSON */ }
    const txt = j?.result || e.stderr || e.message || "";
    r = { ok: false, error: classifyClaudeError(txt) || (e.killed ? "sin_respuesta" : "error"), detalle: String(txt).slice(0, 160) };
  }
  cacheSonda.set(k, { at: now(), ok: r.ok, r });
  return r;
}

export async function runDoctor({ folders = [], claudePath = null, agyPath = null, modelosEsperados = [MODELO_PLAN_DEFECTO, ...CADENA_PROGRAMAR], exec: ex = exec, env = process.env, home = homedir(), exists = existsSync, geminiActivo = false, claudeModelos = null } = {}) {
  const cb = claudePath ? { command: claudePath, prefix: [] } : resolveClaude({ env });
  let claude = { ok: false, modelos: [], faltan: [], error: null };
  if (cb) {
    let version = null; try { version = (await ex(cb, ["--version"], 15000, claudeEnv(env))).match(/\d+(\.\d+){1,3}/)?.[0] || "?"; } catch { /* no responde */ }
    if (!version) claude.error = "no_responde";
    else {
      // Solo se dan por disponibles los ids que respondieron de verdad. sin_login > modelo_no_disponible > otro.
      const ids = [...new Set((claudeModelos?.length ? claudeModelos : [...new Set(Object.values(PRO_MODELOS))]).map(String))];
      const res = [];
      for (const id of ids) res.push([id, await probeClaudeModel(cb, id, { ex, env })]);
      const buenos = res.filter(([, r]) => r.ok).map(([id]) => id), malos = res.filter(([, r]) => !r.ok);
      const err = malos.find(([, r]) => r.error === "sin_login") ? "sin_login" : malos.find(([, r]) => r.error === "modelo_no_disponible") ? "modelo_no_disponible" : malos[0]?.[1].error || null;
      claude = { ok: buenos.length > 0 && !malos.length, modelos: buenos, faltan: malos.map(([id]) => id), error: err, version };
    }
  }
  const ab = resolveAgy({ env, configured: agyPath, exists });
  let agy = { ok: false, cli: "agy", login: null, version: null, modelos: [], faltan: [], flags: null };
  // Gemini apagado (por defecto): no se ejecuta agy ni para diagnosticar; las capacidades lo dicen.
  if (!geminiActivo) agy = { ...agy, activo: false, error: "gemini_apagado" };
  else if (ab) {
    let version = null; try { version = (await ex(ab, ["--version"])).match(/\d+(\.\d+){1,2}/)?.[0] || null; } catch { /* no responde */ }
    if (version && versionOk(version)) {
      const modelos = await agyModels(ab, ex);
      const flags = await verifyAgyFlags(ab, ex);
      agy = { activo: true, ok: modelos.length > 0 && flags.ok, cli: "agy", login: modelos.length ? "google" : null, version, modelos, faltan: modelos.length ? modelosEsperados.filter((m) => !modelos.includes(m)) : [], flags };
    } else agy = { ...agy, version, error: version ? `agy ${version} es anterior a ${VERSION_MINIMA}` : "agy no responde" };
  }
  const repos = await discoverRepos(folders);
  // gemini_cli: compatibilidad con el contrato original (el servidor puede seguir leyéndolo).
  return { claude, agy, gemini_cli: { ok: agy.ok, cli: "agy", login: agy.login, version: agy.version, modelos: agy.modelos }, repos };
}
