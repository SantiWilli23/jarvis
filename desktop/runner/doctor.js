// Diagnóstico del PC para el Modo Pro: ¿están Claude Code y Antigravity CLI (agy)? ¿hay login? ¿qué repos?
// Resultado = `capabilities` de hello/heartbeat (docs/PRO.md §8 + "Ampliaciones P3").
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readdirSync } from "node:fs";
import { join, delimiter } from "node:path";
import { homedir } from "node:os";
import { resolveClaude } from "./claude-runner.js";
import { FLAGS_USADOS } from "./agy-args.js";
import { isGitRepo } from "./git-snapshot.js";

const run = promisify(execFile);

export function resolveAgy({ env = process.env, platform = process.platform, exists = existsSync, configured = null } = {}) {
  const p = configured || env.JARVIS_AGY_PATH;
  if (p) return /\.m?js$/.test(p) ? { command: process.execPath, prefix: [p], nodeAsElectron: !!process.versions.electron } : { command: p, prefix: [] };
  const exe = platform === "win32" ? "agy.exe" : "agy";
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

// SIN VERIFICAR: se desconoce dónde guarda agy su login; heurística por carpetas habituales.
function hasAgyLogin(home, exists) {
  return [".antigravity", join(".config", "antigravity"), join(".gemini", "oauth_creds.json")].some((r) => exists(join(home, r)));
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

export async function runDoctor({ folders = [], claudePath = null, agyPath = null, exec: ex = exec, env = process.env, home = homedir(), exists = existsSync } = {}) {
  const cb = claudePath ? { command: claudePath, prefix: [] } : resolveClaude({ env });
  let claude = { ok: false, modelos: [] };
  if (cb) { try { await ex(cb, ["--version"]); claude = { ok: true, modelos: ["opus", "sonnet"] }; } catch { /* no responde */ } } // los modelos no se pueden listar sin gastar cuota
  const ab = resolveAgy({ env, configured: agyPath, exists });
  let agy = { ok: false, login: null, flags: null };
  if (ab) {
    let ok = false; try { await ex(ab, ["--version"]); ok = true; } catch { /* no responde */ }
    const flags = ok ? await verifyAgyFlags(ab, ex) : null;
    agy = { ok, login: ok && hasAgyLogin(home, exists) ? "google" : null, flags };
  }
  const repos = await discoverRepos(folders);
  // gemini_cli: compatibilidad con el contrato original (el servidor puede seguir leyéndolo).
  return { claude, agy, gemini_cli: { ok: agy.ok, login: agy.login }, repos };
}
