// Diagnóstico del PC para el Modo Pro: ¿están Claude Code y Antigravity CLI (agy)? ¿hay login? ¿qué repos?
// Resultado = `capabilities` de hello/heartbeat (docs/PRO.md §8 + "Ampliaciones P3").
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readdirSync } from "node:fs";
import { join, delimiter } from "node:path";
import { homedir } from "node:os";
import { resolveClaude } from "./claude-runner.js";
import { FLAGS_USADOS, versionOk, VERSION_MINIMA } from "./agy-args.js";
import { resolveAgy } from "./agy-runner.js";
import { isGitRepo } from "./git-snapshot.js";

const run = promisify(execFile);

export { resolveAgy };

async function exec(b, args, timeout = 15000) {
  const p = run(b.command, [...b.prefix, ...args], { timeout, windowsHide: true, env: { ...process.env, ...(b.prefix.length && process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) } });
  p.child.stdin?.end(); // stdin cerrado: agy no debe quedarse esperando
  const { stdout, stderr } = await p;
  return `${stdout}\n${stderr}`;
}

// Comprueba con `agy --help` que existan los flags que usamos. { ok, missing[] }.
export async function verifyAgyFlags(b, exec_ = exec) {
  try { const h = await exec_(b, ["--help"]); const missing = FLAGS_USADOS.filter((f) => !h.includes(f)); return { ok: !missing.length, missing }; }
  catch (e) { return { ok: false, missing: FLAGS_USADOS, error: e.message }; }
}

// Con la sesión iniciada, `agy models` lista los modelos de la cuenta (una línea "id<TAB>nombre"); sin sesión falla.
export async function agyModels(b, exec_ = exec) {
  try { return (await exec_(b, ["models"], 30000)).split(/\r?\n/).map((l) => l.split("\t")[0].trim()).filter((id) => /^[a-z][\w.-]*-[\w.-]+$/i.test(id)); }
  catch { return []; }
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
  let agy = { ok: false, cli: "agy", login: null, version: null, modelos: [], flags: null };
  if (ab) {
    let version = null; try { version = (await ex(ab, ["--version"])).match(/\d+(\.\d+){1,2}/)?.[0] || null; } catch { /* no responde */ }
    if (version && versionOk(version)) {
      const modelos = await agyModels(ab, ex);
      const flags = await verifyAgyFlags(ab, ex);
      agy = { ok: modelos.length > 0 && flags.ok, cli: "agy", login: modelos.length ? "google" : null, version, modelos, flags };
    } else agy = { ...agy, version, error: version ? `agy ${version} es anterior a ${VERSION_MINIMA}` : "agy no responde" };
  }
  const repos = await discoverRepos(folders);
  // gemini_cli: compatibilidad con el contrato original (el servidor puede seguir leyéndolo).
  return { claude, agy, gemini_cli: { ok: agy.ok, cli: "agy", login: agy.login, version: agy.version, modelos: agy.modelos }, repos };
}
