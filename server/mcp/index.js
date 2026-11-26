// Servidor MCP y su OAuth (docs/MEMORIA.md). Fase 0: todo responde 501.
// Se monta antes del estático. Dependencias ya cableadas en server/context.js: db, notes, search, privacy, sessions, limiter, audit, env, now.
import { Router } from "express";

export function createMcp(_deps) {
  return {
    routes() {
      const r = Router();
      r.all(["/mcp", "/mcp/*", "/.well-known/*", "/oauth/*"], (_req, res) => res.status(501).json({ error: "no_implementado" }));
      return r;
    },
  };
}
