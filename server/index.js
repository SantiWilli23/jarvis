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
// "providers.update" lo reenvía el hub tal cual y el panel pide /api/status: aquí no se calcula otra vez.

// Si el PC deja de avisar, se marca desconectado.
setInterval(() => ctx.agent.sweep(ctx.ownerId), 15_000).unref();
// Lo escolar se borra a los 30 días.
setInterval(() => ctx.escolar.purge().catch((e) => console.error("[escolar]", e?.message)), 3_600_000).unref();
// Consultas del navegador sin respuesta: se vencen y se avisa.
setInterval(() => ctx.nav.sweep(ctx.ownerId).catch((e) => console.error("[nav]", e?.message)), 15_000).unref();

// Módulos de la Fase 0: rutinas cada minuto, cola de textos cada 15 s, memoria y repaso cada hora.
const cada = (ms, nombre, fn) => setInterval(() => fn().catch((e) => console.error(`[${nombre}]`, e?.message)), ms).unref();
cada(60_000, "rutinas", () => ctx.rutinas.tick(ctx.ownerId));
cada(15_000, "textos", () => ctx.claudeTextos.tick(ctx.ownerId));
cada(3_600_000, "memoria", () => ctx.memoriaReparto.tick(ctx.ownerId));
cada(3_600_000, "repaso", () => ctx.repaso.tick(ctx.ownerId));
cada(60_000, "recordatorios", () => ctx.cron.recordatorios());
// Al despertar (Render dormido) se entrega lo atrasado sin esperar el primer minuto.
for (const [nombre, fn] of [["recordatorios", () => ctx.cron.recordatorios()], ["rutinas", () => ctx.rutinas.tick(ctx.ownerId)]]) fn().catch((e) => console.error(`[${nombre}]`, e?.message));

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  console.log(`[jarvis] Escuchando en http://localhost:${port}`);
  console.log(`[jarvis] Modelos: ${ctx.keyless ? "sin claves, proveedor de pruebas (fake)" : ctx.chain.join(" > ")} · BD: ${process.env.DATABASE_URL ? "Turso" : "archivo local data/jarvis.db"}`);
});
