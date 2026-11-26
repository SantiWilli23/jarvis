// Recolectar y repartir la memoria cada mes (docs/MEMORIA.md).
// Fase 0: andamiaje. Dependencias ya cableadas en server/context.js: db, notes, inbox, privacy, nav, claudeTextos, audit, getControl, now.
import { Router } from "express";

export function createMemoriaReparto(_deps) {
  return {
    routes: () => Router(),
    async tick() {},
  };
}
