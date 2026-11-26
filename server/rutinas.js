// Rutinas (docs/CONTROL.md).
// Fase 0: andamiaje. Dependencias ya cableadas en server/context.js: db, bus, audit, approvals, escenas, pc, phone, getChat, getControl, now.
import { Router } from "express";

export function createRutinas(_deps) {
  return {
    routes: () => Router(),
    async tick() {},
  };
}
