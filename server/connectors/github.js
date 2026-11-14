// Conector de GitHub: SOLO LECTURA (únicamente peticiones GET). Apagado sin llaves válidas.
// Llaves: GITHUB_TOKEN y opcional GITHUB_TOKENS (separadas por comas), una por cuenta/organización.
// Solo tokens fine-grained (github_pat_); los clásicos (ghp_) se rechazan. El token NUNCA sale de este módulo.
import { redact } from "../pro/redact.js";

const API = "https://api.github.com";
const TTL_REPOS = 5 * 60 * 1000;
const MAX_PAGINAS = 3;

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;
const REF_RE = /^(?!\/)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._\/-]{1,200}$/;
const SHA_RE = /^[0-9a-f]{7,40}$/i;
export const validOwner = (s) => typeof s === "string" && OWNER_RE.test(s);
export const validRepo = (s) => typeof s === "string" && REPO_RE.test(s);
export const validRef = (s) => typeof s === "string" && REF_RE.test(s) && !s.endsWith("/");
export const validSha = (s) => typeof s === "string" && SHA_RE.test(s);

function fullOk(full) {
  const m = /^([^/]+)\/([^/]+)$/.exec(String(full || ""));
  if (!m || !validOwner(m[1]) || !validRepo(m[2])) throw new Error("github_entrada_invalida");
  return `${m[1]}/${m[2]}`;
}
const refPath = (r) => { if (!validRef(r)) throw new Error("github_entrada_invalida"); return r.split("/").map(encodeURIComponent).join("/"); };
const num = (n) => { const v = Number(n); if (!Number.isInteger(v) || v < 1) throw new Error("github_entrada_invalida"); return v; };

export function createGitHub({ env = process.env, fetch: f = globalThis.fetch, now = () => Date.now(), maxPatch = 4000 } = {}) {
  const crudos = [env.GITHUB_TOKEN, ...String(env.GITHUB_TOKENS || "").split(",")].map((s) => String(s || "").trim()).filter(Boolean);
  const unicos = [...new Set(crudos)];
  const tokens = unicos.filter((t) => t.startsWith("github_pat_"));
  const rechazadas = unicos.filter((t) => !t.startsWith("github_pat_")).map((t) => ({ motivo: t.startsWith("ghp_") ? "github_llave_clasica" : "github_llave_no_valida" }));

  const etags = new Map(); // "indice#path" -> { etag, body }
  const dueno = new Map(); // full_name (minúsculas) -> índice de token
  let cacheRepos = null;
  let cacheCuentas = null;

  async function get(path, token) {
    const key = `${tokens.indexOf(token)}#${path}`;
    const prev = etags.get(key);
    let res;
    try {
      res = await f(`${API}${path}`, {
        method: "GET",
        headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "jarvis", authorization: `Bearer ${token}`, ...(prev ? { "if-none-match": prev.etag } : {}) },
        signal: AbortSignal.timeout(8000),
      });
    } catch (e) { throw new Error(redact(`GitHub red: ${e?.message || "fallo"}`)); }
    if (res.status === 304 && prev) return prev.body;
    if (!res.ok) throw new Error(redact(`GitHub HTTP ${res.status}`));
    const body = await res.json();
    const etag = res.headers?.get?.("etag");
    if (etag) etags.set(key, { etag, body });
    return body;
  }
  const tokenDe = async (full) => {
    full = fullOk(full);
    if (!dueno.has(full.toLowerCase())) await api.repos();
    const i = dueno.get(full.toLowerCase());
    if (i === undefined) throw new Error("github_repo_desconocido");
    return { full, token: tokens[i] };
  };
  const r = async (full, sub) => { const x = await tokenDe(full); return get(`/repos/${x.full}${sub}`, x.token); };

  const api = {
    enabled: tokens.length > 0, rechazadas,
    async cuentas() {
      if (cacheCuentas && now() - cacheCuentas.at < TTL_REPOS) return cacheCuentas.lista;
      const lista = [];
      for (const t of tokens) { const u = await get("/user", t); if (u?.login && !lista.includes(u.login)) lista.push(u.login); }
      cacheCuentas = { at: now(), lista };
      return lista;
    },
    async repos() {
      if (cacheRepos && now() - cacheRepos.at < TTL_REPOS) return cacheRepos.lista;
      const lista = []; const nuevo = new Map();
      for (let i = 0; i < tokens.length; i++) {
        for (let p = 1; p <= MAX_PAGINAS; p++) {
          const page = await get(`/user/repos?affiliation=owner,collaborator,organization_member&sort=pushed&per_page=100&page=${p}`, tokens[i]);
          for (const x of Array.isArray(page) ? page : []) {
            const k = String(x.full_name).toLowerCase();
            if (nuevo.has(k)) continue;
            nuevo.set(k, i);
            lista.push({ full_name: x.full_name, private: !!x.private, default_branch: x.default_branch, pushed_at: x.pushed_at });
          }
          if (!Array.isArray(page) || page.length < 100) break;
        }
      }
      dueno.clear(); for (const [k, v] of nuevo) dueno.set(k, v);
      cacheRepos = { at: now(), lista };
      return lista;
    },
    ramas: (full) => r(full, "/branches?per_page=100"),
    rama: async (full, name) => r(full, `/branches/${refPath(name)}`),
    prs: (full) => r(full, "/pulls?state=all&sort=created&direction=desc&per_page=20"),
    pr: async (full, n) => r(full, `/pulls/${num(n)}`),
    async compare(full, base, head) {
      const j = await r(full, `/compare/${refPath(base)}...${refPath(head)}`);
      return {
        status: j.status, ahead_by: j.ahead_by, behind_by: j.behind_by, total_commits: j.total_commits,
        commits: (j.commits || []).map((c) => ({ sha: c.sha, message: String(c.commit?.message || "").split("\n")[0], date: c.commit?.author?.date })),
        files: (j.files || []).map((x) => ({ filename: x.filename, status: x.status, additions: x.additions, deletions: x.deletions,
          ...(typeof x.patch === "string" && maxPatch > 0 ? { patch: x.patch.length > maxPatch ? x.patch.slice(0, maxPatch) + "\n[... recortado]" : x.patch } : {}) })),
      };
    },
    async checks(full, sha) { if (!validSha(sha)) throw new Error("github_entrada_invalida"); return r(full, `/commits/${sha}/check-runs`); },
    async arbol(full, rama) {
      const j = await r(full, `/git/trees/${refPath(rama)}?recursive=1`);
      return { truncated: !!j.truncated, archivos: (j.tree || []).filter((x) => x.type === "blob").map((x) => x.path) };
    },
  };
  return api;
}
