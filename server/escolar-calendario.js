// Pruebas a Google Calendar, regla MDE (docs/NAV.md).
// Fase 0: andamiaje. Dependencias ya cableadas en server/context.js: db, escolar, crypto, approvals, audit, getGoogle, now.
import { Router } from "express";

export function createEscolarCalendario(_deps) {
  return {
    routes: () => Router(),
  };
}
