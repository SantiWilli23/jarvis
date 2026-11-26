// Servidor MCP de memoria y su OAuth (docs/MEMORIA.md). Se monta antes del estático.
// Dependencias cableadas en server/context.js: db, notes, search, privacy, sessions, limiter, audit, env, now.
import { Router } from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bearer } from "../auth/middleware.js";
import { createInbox } from "../memory/inbox.js";
import { oauthRoutes, baseUrl } from "./oauth.js";
import { createTools } from "./tools.js";
import { handleRpc } from "./jsonrpc.js";

const CFG = fileURLToPath(new URL("../../config/mcp.json", import.meta.url));
const RUTAS = ["/mcp", "/mcp/*", "/.well-known/*", "/oauth/*"];
const ORIGENES = ["https://claude.ai", "https://claude.com"];

export function createMcp(deps) {
  const cfg = deps.config || JSON.parse(readFileSync(CFG, "utf8"));
  const { sessions, env, notes } = deps;
  return {
    activo: () => cfg.activo === true,
    routes() {
      const r = Router();
      if (cfg.activo !== true) {
        r.all(RUTAS, (_req, res) => res.status(404).json({ error: "mcp_inactivo" }));
        return r;
      }
      const tools = createTools({ ...deps, inbox: createInbox({ notes }) });
      r.use(oauthRoutes(deps));
      r.all("/mcp", async (req, res, next) => {
        try {
          res.set("Cache-Control", "no-store");
          const origen = req.get("origin");
          if (origen && ![...ORIGENES, new URL(baseUrl(env, req)).origin].includes(origen)) return res.status(403).json({ error: "origen_no_permitido" });
          // Solo cabecera Bearer (nunca cookie) y solo dispositivos "mcp".
          const token = bearer(req);
          const s = token ? await sessions.verify(token) : null;
          if (!s || s.device.kind !== "mcp") {
            res.set("WWW-Authenticate", `Bearer resource_metadata="${baseUrl(env, req)}/.well-known/oauth-protected-resource"${token ? ', error="invalid_token"' : ""}`);
            return res.status(401).json({ error: "no_autorizado" });
          }
          if (req.method !== "POST") return res.set("Allow", "POST").status(405).json({ error: "metodo_no_permitido" });
          const quien = { userId: Number(s.user.id), cliente: s.device.name.replace(/^MCP: /, "") };
          const out = await handleRpc(req.body, { tools, quien });
          if (!out.body) return res.status(out.status).end();
          res.status(out.status).json(out.body);
        } catch (e) { next(e); }
      });
      r.all(RUTAS, (_req, res) => res.status(404).json({ error: "no_encontrado" }));
      return r;
    },
  };
}
