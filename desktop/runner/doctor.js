// Diagnóstico del PC para el Modo Pro: ¿están Claude Code y Antigravity CLI (agy)? ¿hay login? ¿qué repos?
// Resultado = `capabilities` de hello/heartbeat (docs/PRO.md §8 + "Ampliaciones P3").
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readdirSync } from "node:fs";
import { join, delimiter } from "node:path";
import { homedir } from "node:os";
import { resolveClaude } from "./claude-runner.js";
import { FLAGS_USADOS, MODELO_PLAN_DEFECTO, CADENA_PROGRAMAR } from "./agy-args.js";
import { isGitRepo } from "./git-snapshot.js";

const run = promisify(execFile);

export function resolveAgy({ env = process.env, platform = process.platform, exists = existsSync, configured = null } = {}) {
  const p = configured || env.JARVIS_AGY_PATH;
  if (p) return /\.m?js$/.test(p) ? { command: process.execPath, prefix: [p], nodeAsElectron: !!process.versions.electron } : { command: p, prefix: [] };
  const exe = platform === "win32" ? "agy.exe" : "agy";
  if (platform === "win32" && env.LOCALAPPDATA) { const l = join(env.LOCALAPPDATA, "agy", "bin", exe); if (exists(l)) return { command: l, prefix: [] }; }
  for (const dir of (env.PATH || env.Path || "").split(delimiter).filter(Boolean)) if (exists(join(dir, exe))) return { command: join(dir, exe), prefix: [] };
  return null;
}

async function exec(b, args, timeout = 15000) {
  const { stdout, stderr } = await run(b.command, [...b.prefix, ...args], { timeout, windowsHide: true, env: { ...process.env, ...(b.prefix.length && process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) } });
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
export async function listAgyModels(b, exec_ = exec) {
  try { return parseAgyModels(await exec_(b, ["models"], 45000)); } catch { return []; }
}

export async function discoverRepos(folders = [], isGit = isGitRepo) {
  const out = [];
  for (const f of folders.filter(Boolean)) {
    if (await isGit(f)) out.push(f);
    let kids = []; try { kids = readdirSync(f, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules"); } catch { /* sin acceso */ }
    for (const d of kids) { const p = join(f, d.name); if (existsSync(join(p, ".git")) && await isGit(p)) out.push(p); }
  }
  return [...new Set(out)];
}

export async function runDoctor({ folders = [], claudePath = null, agyPath = null, modelosEsperados = [MODELO_PLAN_DEFECTO, ...CADENA_PROGRAMAR], exec: ex = exec, env = process.env, home = homedir(), exists = existsSync } = {}) {
  const cb = claudePath ? { command: claudePath, prefix: [] } : resolveClaude({ env });
  let claude = { ok: false, modelos: [] };
  if (cb) { try { await ex(cb, ["--version"]); claude = { ok: true, modelos: ["opus", "sonnet"] }; } catch { /* no responde */ } } // los modelos no se pueden listar sin gastar cuota
  const ab = resolveAgy({ env, configured: agyPath, exists });
  let agy = { ok: false, login: null, modelos: [], faltan: [], flags: null };
  if (ab) {
    let ok = false; try { await ex(ab, ["--version"]); ok = true; } catch { /* no responde */ }
    const flags = ok ? await verifyAgyFlags(ab, ex) : null;
    const modelos = ok ? await listAgyModels(ab, ex) : [];
    // login = `agy models` lista modelos; faltan = modelos configurados que la cuenta no ofrece (motivo para marcarlo).
    agy = { ok, login: modelos.length ? "google" : null, modelos, faltan: modelos.length ? modelosEsperados.filter((m) => !modelos.includes(m)) : [], flags };
  }
  const repos = await discoverRepos(folders);
  // gemini_cli: compatibilidad con el contrato original (el servidor puede seguir leyéndolo).
  return { claude, agy, gemini_cli: { ok: agy.ok, login: agy.login }, repos };
}
