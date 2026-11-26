// Plan de estudio y repaso (docs/NAV.md, "Plan, repaso y calendario MDE").
// Fase 0: andamiaje. Dependencias ya cableadas en server/context.js: db, crypto, escolar, claudeTextos, audit, now.
import { Router } from "express";

export function createRepaso(_deps) {
  return {
    routes: () => Router(),
    async tick() {},
  };
}
