// Motivos por los que Pro no está habilitado, a partir de las capacidades que reporta el PC.
export function proReasons({ pcOnline, caps, cfg }) {
  const m = [];
  const req = cfg.requisitos || {};
  if (!pcOnline) m.push("pc_apagado");
  const c = caps || {};
  const need = req.claude_modelos || [];
  if (!c.claude?.ok || need.some((x) => !(c.claude.modelos || []).includes(x))) m.push("claude_no_listo");
  const g = c.agy || c.gemini_cli; // Antigravity CLI (agy); gemini_cli solo por compatibilidad
  if (!g?.ok || (req.gemini_login && g.login !== req.gemini_login)) m.push("gemini_sin_login");
  if (req.repos_git && !(c.repos || []).length) m.push("sin_repos_git");
  return m;
}
