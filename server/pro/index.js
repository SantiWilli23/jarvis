// Modo Pro: devuelve el objeto `ctx.pro`. Contrato: docs/PRO.md.
import { loadProConfig } from "./config.js";
import { proReasons, claudeIds } from "./reasons.js";
import { createOrchestrator } from "./orchestrator.js";

export { proReasons, claudeIds, loadProConfig };
export { ProError } from "./orchestrator.js";

export function createPro({ db, bus, agent, approvals, audit, permissions = {}, config = loadProConfig(), now = () => Date.now(), textProvider, quota, groq }) {
  const orch = createOrchestrator({ db, bus, agent, approvals, audit, permissions, config, now, textProvider, quota, groq });
  let last = null;
  // El PC volvió a avisar "en línea" (reinicio): los jobs que tenía en marcha se dan por fallidos.
  bus.on("pc.hello", ({ userId }) => { orch.pcReinicio(userId).catch(() => {}); });
  // Avisa a la web (pro.status) cuando cambia la habilitación (el PC se enciende/apaga o cambia capacidades).
  bus.on("pc.status", ({ userId }) => {
    const s = orch.status(userId), k = JSON.stringify(s);
    if (k !== last) { last = k; bus.emit("pro.status", { userId, ...s }); }
  });
  return { config, orch, async status(userId) { return orch.status(userId); } };
}
