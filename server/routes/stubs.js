import { Router } from "express";

// Esqueletos: /api/agent/* llega en la Fase 2 (app de escritorio) y /api/telegram/webhook en la Fase 4.
export function stubRoutes() {
  const r = Router();
  r.all("/agent/*", (_req, res) => res.status(501).json({ error: "no_implementado", fase: 2 }));
  return r;
}
