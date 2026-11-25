import "dotenv/config";
import { createServer } from "node:http";
import { createDb } from "./db/client.js";
import { buildContext } from "./context.js";
import { createApp } from "./app.js";
import { createHub } from "./ws-hub.js";

if (!process.env.OWNER_PASSWORD) {
  console.warn("[jarvis] Falta OWNER_PASSWORD en .env: nadie podrá iniciar sesión hasta que la ponga.");
}
const db = createDb({ url: process.env.DATABASE_URL, authToken: process.env.DATABASE_AUTH_TOKEN });
const ctx = await buildContext({ db });
const app = createApp(ctx);
const server = createServer(app);
ctx.hub = createHub({
  server, sessions: ctx.sessions, bus: ctx.bus,
  initial: async (userId) => {
    const s = await ctx.status(userId);
    return [{ type: "state", state: s.pendientes_aprobacion ? "permiso" : "idle" }, { type: "pc.status", ...s.pc }, { type: "providers.update", providers: s.providers }, { type: "pro.status", ...s.pro }, ...ctx.resultados.pendientes(userId)];
  },
});
// Cuando cambia algo de proveedores o tareas, el panel pide el estado completo.
ctx.bus.on("providers.update", async ({ userId }) => {
  ctx.hub.send(userId, { type: "providers.update", providers: (await ctx.status(userId)).providers });
});

// Si el PC deja de avisar, se marca desconectado.
setInterval(() => ctx.agent.sweep(ctx.ownerId), 15_000).unref();
// Lo escolar se borra a los 30 días.
setInterval(() => ctx.escolar.purge().catch((e) => console.error("[escolar]", e?.message)), 3_600_000).unref();
// Consultas del navegador sin respuesta: se vencen y se avisa.
setInterval(() => ctx.nav.sweep(ctx.ownerId).catch((e) => console.error("[nav]", e?.message)), 15_000).unref();

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  console.log(`[jarvis] Escuchando en http://localhost:${port}`);
  console.log(`[jarvis] Modelos: ${ctx.keyless ? "sin claves, proveedor de pruebas (fake)" : ctx.chain.join(" > ")} · BD: ${process.env.DATABASE_URL ? "Turso" : "archivo local data/jarvis.db"}`);
});
