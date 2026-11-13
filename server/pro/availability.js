// Pro habilitado solo si PC en línea + Claude (opus y sonnet) + Gemini CLI con login Google + repos git.
import { proReasons } from "./reasons.js";

export function availability({ agent, config }) {
  agent.sweep?.();
  const motivos = proReasons({ pcOnline: agent.view().online, caps: agent.capabilities(), cfg: config });
  return { habilitado: motivos.length === 0, motivos };
}
export const reposOf = (agent) => agent.capabilities()?.repos || [];
const key = (p) => String(p || "").replace(/\/g, "/").replace(/\/+$/, "").toLowerCase();
export const samePath = (a, b) => key(a) === key(b);
export const insideAny = (p, dirs) => !dirs?.length || dirs.some((d) => key(p) === key(d) || key(p).startsWith(key(d) + "/"));

// Un repo es válido si el PC lo declara como repo git y está dentro de las carpetas permitidas.
export function repoValid(repo, { agent, permissions }) {
  if (!repo) return false;
  const known = reposOf(agent).find((r) => samePath(r, repo));
  return !!known && insideAny(known, permissions?.carpetas_permitidas);
}
export const canonicalRepo = (repo, agent) => reposOf(agent).find((r) => samePath(r, repo)) || repo;
