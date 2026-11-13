// Arma todas las piezas del servidor (inyectables para pruebas).
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { get, all } from "./db/client.js";
import { initSchema, ensureOwner } from "./db/index.js";
import { createSessions } from "./auth/sessions.js";
import { createLoginLimiter } from "./auth/ratelimit.js";
import { buildProviders } from "./providers/index.js";
import { createQuota } from "./router/quota.js";
import { createPrivacy } from "./router/privacy.js";
import { createRouter } from "./router/chain.js";
import { createNotes } from "./memory/notes.js";
import { createSearch } from "./memory/search.js";
import { createInbox } from "./memory/inbox.js";
import { createTasks } from "./queue/tasks.js";
import { createDirect } from "./queue/direct.js";
import { createPrepare } from "./queue/prepare.js";
import { createApprovals } from "./approvals.js";
import { createAudit } from "./audit.js";
import { createStt } from "./stt.js";
import { createChatService } from "./chat-service.js";
import { createTts } from "./tts.js";

const cfgPath = (f) => fileURLToPath(new URL(`../config/${f}`, import.meta.url));
export const loadJson = (f) => JSON.parse(readFileSync(cfgPath(f), "utf8"));

export async function buildContext({ db, env = process.env, fetch: f, now = () => Date.now(), providers: providersOverride } = {}) {
  const config = loadJson("providers.json");
  const permissions = loadJson("permissions.json");
  const persona = readFileSync(cfgPath("persona.md"), "utf8");
  const { fts } = await initSchema(db);
  const ownerId = await ensureOwner(db, { name: env.OWNER_NAME || "señor", password: env.OWNER_PASSWORD });

  const providers = providersOverride || buildProviders({ env, fetch: f, config });
  const realChain = config.cadena_gratis.filter((id) => providers[id]?.enabled);
  const keyless = realChain.length === 0;
  const chain = keyless ? ["fake"] : realChain;
  const privacy = createPrivacy({ allowed: config.permite_privado, localSafe: keyless ? ["fake"] : [] });
  const limits = Object.fromEntries(Object.entries(config.proveedores).map(([id, p]) => [id, { rpm: p.limites?.rpm ?? null, rpd: p.limites?.rpd ?? null }]));
  const quota = createQuota({ db, limits, now });
  const bus = new EventEmitter();
  const state = { lastProvider: null, pc: { online: false } };
  bus.on("chat.done", ({ provider }) => { state.lastProvider = provider; });

  const router = createRouter({ providers, chain, orderByKind: config.orden_por_tipo, quota, privacy });
  const notes = createNotes({ db, fts, now });
  const search = createSearch({ db, fts });
  const inbox = createInbox({ notes });
  const audit = createAudit({ db, now });
  const tasks = createTasks({ db, bus, now });
  const direct = createDirect({ tasks });
  const prepare = createPrepare({ router, tasks });
  const approvals = createApprovals({ db, bus, audit, now });
  const sessions = createSessions({ db, now });
  const limiter = createLoginLimiter({ db, now });
  const stt = createStt({ apiKey: env.GROQ_API_KEY, fetch: f });
  const chat = createChatService({ db, router, privacy, search, tasks, prepare, bus, persona, now });
  const tts = createTts({ db, env, fetch: f, config: config.voz, privacy, now,
    phrasesDir: fileURLToPath(new URL("../web/audio/phrases", import.meta.url)),
    cacheDir: fileURLToPath(new URL("../data/cache/tts", import.meta.url)) });

  // El estado "permiso" del orbe sigue a las aprobaciones pendientes.
  bus.on("approval.request", ({ userId }) => bus.emit("state", { userId, state: "permiso" }));
  bus.on("approval.resolved", async ({ userId }) => {
    if (!(await approvals.pending(userId)).length) bus.emit("state", { userId, state: "idle" });
  });

  // Foto del estado para el panel (REST /api/status y WS al conectar).
  async function status(userId) {
    const ids = [...Object.keys(config.proveedores).filter((id) => id !== "fake" || keyless)];
    const snap = await quota.snapshot(userId, ids);
    const t = now();
    const provs = ids.map((id) => {
      const c = config.proveedores[id], p = providers[id], s = snap[id];
      const paused = s.paused_until && s.paused_until > t;
      return {
        id, nombre: c.nombre, rol: c.rol, en_cadena: chain.includes(id),
        estado: !p?.enabled ? (c.apagado ? "apagado" : "sin_clave") : paused ? "pausado" : "activo",
        usado_min: s.used_min, limite_min: s.limit_min, usado_dia: s.used_day, limite_dia: s.limit_day,
        pausado_hasta: paused ? s.paused_until : null, activo: state.lastProvider === id,
      };
    });
    const puestos = config.puestos.map((p) => ({ id: p.id, nombre: p.nombre, rol: p.rol, pc: !!p.pc, estado: p.pc ? (state.pc.online ? "activo" : "pc_apagado") : "apagado" }));
    const q = await tasks.counts(userId);
    const queue = (await tasks.list(userId)).filter((x) => ["pendiente", "por_revisar", "reclamada", "en_curso"].includes(x.status)).reverse()
      .map((x) => ({ id: x.id, seq: x.seq, mode: x.mode, status: x.status, text: x.text.slice(0, 200), pasos: x.prepared?.pasos?.length || 0, por: x.prepared?.por || null, at: x.created_at }));
    const lastSync = await get(db, "SELECT value FROM settings WHERE user_id=? AND key='ultima_sync_pc'", [userId]);
    const conn = (n, ok) => ({ nombre: n, ok: !!ok });
    return {
      state: "idle", keyless, fts,
      providers: provs, puestos,
      memory: { ...(await notes.counts(userId)), ultima_sync_pc: lastSync?.value ? Number(lastSync.value) : null, bd: env.DATABASE_URL ? "Turso" : "local" },
      queue: { items: queue, total: queue.length, porEstado: q },
      pc: state.pc,
      connections: [conn("Groq", providers.groq?.enabled), conn("Gemini", providers.gemini?.enabled), conn("OpenRouter", providers.openrouter?.enabled), conn("Telegram", !!env.TELEGRAM_BOT_TOKEN),
        conn("Turso", !!env.DATABASE_URL), conn("Render", !!env.RENDER), conn("Gmail", 0), conn("Calendar", 0), conn("Spotify", 0)],
      pendientes_aprobacion: (await approvals.pending(userId)).length,
      voz: await tts.status(userId),
    };
  }

  return { db, env, config, permissions, persona, ownerId, providers, chain, keyless, privacy, quota, bus, state, router,
    notes, search, inbox, audit, tasks, direct, prepare, approvals, sessions, limiter, stt, tts, chat, status, now, fts };
}

export { all };
