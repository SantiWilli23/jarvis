// Modo Pro: módulo base. El agente P2 (orquestador) llena createPro; aquí solo está lo compartido
// (habilitación) para que /api/status y la web ya puedan consultarlo. Contrato: docs/PRO.md.
import { loadProConfig } from "./config.js";

// Motivos por los que Pro no está habilitado, a partir de las capacidades que reporta el PC.
export function proReasons({ pcOnline, caps, cfg }) {
  const m = [];
  const req = cfg.requisitos || {};
  if (!pcOnline) m.push("pc_apagado");
  const c = caps || {};
  const need = req.claude_modelos || [];
  if (!c.claude?.ok || need.some((x) => !(c.claude.modelos || []).includes(x))) m.push("claude_no_listo");
  if (!c.gemini_cli?.ok || (req.gemini_login && c.gemini_cli.login !== req.gemini_login)) m.push("gemini_sin_login");
  if (req.repos_git && !(c.repos || []).length) m.push("sin_repos_git");
  return m;
}

// STUB (P2): firma que otros agentes deben respetar. Devuelve el objeto `ctx.pro`.
//   status(userId) -> { habilitado, motivos[] }
//   (P2 añade: threads/messages/send/decide/job queue; ver docs/PRO.md)
export function createPro({ db, bus, agent, config = loadProConfig(), now = () => Date.now() }) {
  return {
    config,
    async status(_userId) {
      const motivos = proReasons({ pcOnline: agent.view().online, caps: agent.capabilities(), cfg: config });
      return { habilitado: motivos.length === 0, motivos };
    },
  };
}
