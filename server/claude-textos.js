// Cola del PC para Claude sin herramientas, carga cifrada (docs/CONTROL.md).
// Fase 0: andamiaje. Dependencias ya cableadas en server/context.js: db, crypto, bus, agent, audit, now.
import { Router } from "express";

export function createClaudeTextos(_deps) {
  return {
    routes: () => Router(),
    agentRoutes: () => Router(),
    async tick() {},
  };
}
