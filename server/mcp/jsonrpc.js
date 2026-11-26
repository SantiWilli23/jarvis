// MCP sobre Streamable HTTP sin estado: JSON-RPC 2.0 a mano (initialize, ping, tools/list, tools/call).
import { TOOLS } from "./tools.js";

export const VERSIONES = ["2025-11-25", "2025-06-18", "2025-03-26"];
const error = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

// Devuelve { status, body? }. Notificaciones y respuestas del cliente: 202 sin cuerpo.
export async function handleRpc(msg, { tools, quien }) {
  if (!msg || typeof msg !== "object" || Array.isArray(msg) || msg.jsonrpc !== "2.0") return { status: 400, body: error(null, -32600, "Petición inválida") };
  const { id, method, params } = msg;
  if (id === undefined || id === null || typeof method !== "string") return { status: 202 };
  const ok = (result) => ({ status: 200, body: { jsonrpc: "2.0", id, result } });
  if (method === "initialize") {
    const v = VERSIONES.includes(params?.protocolVersion) ? params.protocolVersion : VERSIONES[0];
    return ok({ protocolVersion: v, capabilities: { tools: {} }, serverInfo: { name: "jarvis-memoria", version: "1.0.0" } });
  }
  if (method === "ping") return ok({});
  if (method === "tools/list") return ok({ tools: TOOLS });
  if (method === "tools/call") {
    const out = await tools.call(quien, params?.name, params?.arguments || {});
    return out ? ok(out) : { status: 200, body: error(id, -32602, "Herramienta desconocida") };
  }
  return { status: 200, body: error(id, -32601, "Método desconocido") };
}
