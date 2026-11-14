import { Router } from "express";
import { validOwner, validRepo } from "../connectors/github.js";

// Solo lectura. Nunca devuelve tokens: el panel ve {ok, cuentas, n_repos}.
export function githubRoutes(ctx) {
  const r = Router();
  const gh = () => ctx.github;
  const off = (res) => res.status(503).json({ error: "github_apagado" });
  r.get("/status", async (_req, res) => {
    const g = gh();
    if (!g.enabled) return res.json({ ok: false, cuentas: [], n_repos: 0, ...(g.rechazadas.length ? { motivo: g.rechazadas[0].motivo } : {}) });
    try { res.json({ ok: true, cuentas: await g.cuentas(), n_repos: (await g.repos()).length }); }
    catch { res.json({ ok: false, cuentas: [], n_repos: 0, motivo: "github_error" }); }
  });
  r.get("/repos", async (_req, res) => {
    if (!gh().enabled) return off(res);
    try { res.json({ repos: await gh().repos() }); } catch { res.status(502).json({ error: "github_error" }); }
  });
  r.get("/repos/:owner/:repo/branches", async (req, res) => {
    const { owner, repo } = req.params;
    if (!validOwner(owner) || !validRepo(repo)) return res.status(400).json({ error: "entrada_invalida" });
    if (!gh().enabled) return off(res);
    try { res.json({ branches: (await gh().ramas(`${owner}/${repo}`)).map((b) => ({ name: b.name, sha: b.commit?.sha, protected: !!b.protected })) }); }
    catch (e) { const d = /desconocido/.test(e.message); res.status(d ? 404 : 502).json({ error: d ? "repo_desconocido" : "github_error" }); }
  });
  return r;
}
