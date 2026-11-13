import { Router } from "express";

// Esqueletos: /api/telegram/webhook en la Fase 4.
export function stubRoutes() {
  const r = Router();
  r.all("/telegram/webhook", (_req, res) => res.status(501).json({ error: "no_implementado", fase: 4 }));
  return r;
}
