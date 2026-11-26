// Freno y registro de acciones (docs/CONTROL.md).
// Fase 0: andamiaje. Dependencias ya cableadas en server/context.js: db, bus, audit, approvals, tasks, agent, pc, now.
import { Router } from "express";

export function createControl(_deps) {
  return {
    routes: () => Router(),
    agentRoutes: () => Router(),
  };
}
