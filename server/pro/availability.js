// Pro habilitado solo con PC en línea + Claude (ids de config/pro.json verificados) + repos git.
// Gemini es opcional: sus avisos (`avisos`) no bloquean.
import { proReasons, proNotices, claudeRequired } from "./reasons.js";

export function availability({ agent, config, permissions = {} }) {
  agent.sweep?.();
  const caps = agent.capabilities();
  const geminiActivo = agent.geminiActive?.() ?? false;
  const motivos = proReasons({ pcOnline: agent.view().online, caps, cfg: config });
  const avisos = proNotices({ caps, geminiActivo, geminiFolders: permissions.carpetas_gemini || [] });
  const out = { habilitado: motivos.length === 0, motivos, avisos, gemini: { activo: geminiActivo, listo: !!agent.geminiReady?.() } };
  if (motivos.includes("claude_modelo_no_disponible")) out.claude_faltan = claudeRequired(config).filter((x) => !(caps?.claude?.modelos || []).includes(x));
  return out;
}
export const reposOf = (agent) => agent.capabilities()?.repos || [];
const key = (p) => String(p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
export const samePath = (a, b) => key(a) === key(b);
export const insideAny = (p, dirs) => !dirs?.length || dirs.some((d) => key(p) === key(d) || key(p).startsWith(key(d) + "/"));

// Un repo es válido si el PC lo declara como repo git y está dentro de las carpetas permitidas.
export function repoValid(repo, { agent, permissions }) {
  if (!repo) return false;
  const known = reposOf(agent).find((r) => samePath(r, repo));
  return !!known && insideAny(known, permissions?.carpetas_permitidas);
}
export const canonicalRepo = (repo, agent) => reposOf(agent).find((r) => samePath(r, repo)) || repo;
// Gemini solo puede trabajar en un repo si está activo, listo y el repo cae DENTRO de carpetas_gemini (lista vacía = no).
export const geminiUsable = (repo, { agent, permissions }) => !!agent.geminiReady?.() && (permissions?.carpetas_gemini || []).filter(Boolean).length > 0 && insideAny(repo, permissions.carpetas_gemini);
