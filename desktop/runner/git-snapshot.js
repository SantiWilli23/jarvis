// Diff real de un repo sin tocar su índice ni su árbol de trabajo (docs/PRO.md §7).
// Usa un índice temporal propio: GIT_INDEX_FILE=<tmp> git add -A && git write-tree. Respeta .gitignore.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";

const run = promisify(execFile);
const GIT = ["-c", "core.quotepath=false", "-c", "core.fsmonitor=false", "-c", "core.autocrlf=false"];

export async function git(repo, args, env = {}) {
  const r = await run("git", [...GIT, ...args], { cwd: repo, env: { ...process.env, ...env }, maxBuffer: 128 * 1024 * 1024, windowsHide: true });
  return r.stdout;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const real = (p) => { try { return realpathSync.native(p); } catch { return resolve(p); } };
const norm = (p) => (process.platform === "win32" ? real(p).toLowerCase() : real(p));

// ¿El repo está dentro de alguna de las carpetas permitidas (o es una de ellas)?
export function isInsideAllowed(repo, carpetas = []) {
  const r = norm(repo);
  return carpetas.filter(Boolean).some((c) => { const rel = relative(norm(c), r); return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)); });
}

// Es repo git cuando la raíz del árbol de trabajo es exactamente esa carpeta.
export async function isGitRepo(repo) {
  try { const top = (await git(repo, ["rev-parse", "--show-toplevel"])).trim(); return norm(top) === norm(repo); } catch { return false; }
}

// Devuelve el id del árbol (tree) que representa el estado actual del trabajo (incluye archivos nuevos y borrados).
export async function snapshot(repo) {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-idx-"));
  const env = { GIT_INDEX_FILE: join(dir, "index") };
  try {
    let hasHead = true;
    try { await git(repo, ["rev-parse", "--verify", "-q", "HEAD"]); } catch { hasHead = false; } // repo sin commits: índice vacío
    if (hasHead) await git(repo, ["read-tree", "HEAD"], env);
    // OneDrive/antivirus a veces bloquean un archivo un instante: un reintento.
    try { await git(repo, ["add", "-A"], env); } catch { await sleep(700); await git(repo, ["add", "-A"], env); }
    return (await git(repo, ["write-tree"], env)).trim();
  } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

// { files:[{status,path,from?}], text } con name-status + stat, recortado a max caracteres.
export async function diffBetween(repo, a, b, max = 200000) {
  if (!a || !b || a === b) return { files: [], text: "" };
  const ns = await git(repo, ["diff", "--name-status", "-M", a, b]);
  const stat = await git(repo, ["diff", "--stat", "-M", a, b]);
  const files = ns.split(/\r?\n/).filter(Boolean).map((l) => {
    const [status, p1, p2] = l.split("\t");
    return p2 ? { status, from: p1, path: p2 } : { status, path: p1 };
  });
  let text = `${ns.trim()}\n\n${stat.trim()}`;
  if (text.length > max) text = text.slice(0, max) + "\n[... recortado]";
  return { files, text };
}

// Commit local SOLO de los archivos de la ronda (git add + git commit -- rutas). NUNCA push. Rechaza (error con .code
// "cambios_ajenos") si esos archivos ya tenían cambios sin commit antes de la ronda (se mezclarían con los del usuario)
// o si cambiaron después de que terminó la ronda. Lo demás del repo (cambios del usuario en otros archivos) no se toca.
export async function commitPaths(repo, message, paths, { expectedTree = null, baseTree = null } = {}) {
  const lista = [...new Set((paths || []).filter(Boolean))];
  if (!lista.length) return { commit: null, vacio: true };
  const fallo = (msg) => Object.assign(new Error(msg), { code: "cambios_ajenos" });
  let hasHead = true;
  try { await git(repo, ["rev-parse", "--verify", "-q", "HEAD"]); } catch { hasHead = false; }
  const tocados = async (a, b) => (await git(repo, ["diff", "--name-only", a, b, "--", ...lista])).split(/\r?\n/).filter(Boolean);
  if (baseTree && hasHead) { const x = await tocados("HEAD", baseTree); if (x.length) throw fallo(`ya tenían cambios sin commit antes de la ronda: ${x.slice(0, 5).join(", ")}`); }
  if (expectedTree) { const cur = await snapshot(repo); if (cur !== expectedTree) { const x = await tocados(expectedTree, cur); if (x.length) throw fallo(`cambiaron después de la ronda: ${x.slice(0, 5).join(", ")}`); } }
  await git(repo, ["add", "-A", "--", ...lista]);
  const staged = (await git(repo, ["diff", "--cached", "--name-only", "--", ...lista])).trim();
  if (!staged) return { commit: null, vacio: true };
  await git(repo, ["commit", "-q", "-m", String(message).slice(0, 500), "--", ...lista]);
  return { commit: (await git(repo, ["rev-parse", "HEAD"])).trim(), vacio: false, archivos: staged.split(/\r?\n/) };
}

// Commit local de todo el trabajo (git add -A && git commit). Solo para jobs antiguos sin lista de archivos. NUNCA push.
export async function commitAll(repo, message) {
  await git(repo, ["add", "-A"]);
  const pend = (await git(repo, ["status", "--porcelain"])).trim();
  if (!pend) return { commit: null, vacio: true };
  await git(repo, ["commit", "-q", "-m", String(message).slice(0, 500)]);
  return { commit: (await git(repo, ["rev-parse", "HEAD"])).trim(), vacio: false };
}
