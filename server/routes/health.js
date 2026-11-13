import { Router } from "express";

export function healthRoutes() {
  const r = Router();
  r.get("/health", (_req, res) => res.json({ ok: true, name: "jarvis", ts: Date.now() }));
  return r;
}
