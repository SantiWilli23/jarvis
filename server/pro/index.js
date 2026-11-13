// Modo Pro: devuelve el objeto `ctx.pro`. Contrato: docs/PRO.md.
import { loadProConfig } from "./config.js";
import { proReasons } from "./reasons.js";
import { createOrchestrator } from "./orchestrator.js";

export { proReasons };
export { ProError } from "./orchestrator.js";

export function createPro({ db, bus, agent, approvals, audit, permissions = {}, config = loadProConfig(), now = () => Date.now(), textProvider }) {
  const orch = createOrchestrator({ db, bus, agent, approvals, audit, permissions, config, now, textProvider });
  let last = null;
  // Avisa a la web (pro.status) cuando cambia la habilitación (el PC se enciende/apaga o cambia capacidades).
  bus.on("pc.status", ({ userId }) => {
    const s = orch.status(userId), k = JSON.stringify(s);
    if (k !== last) { last = k; bus.emit("pro.status", { userId, ...s }); }
  });
  return { config, orch, async status(userId) { return orch.status(userId); } };
}
