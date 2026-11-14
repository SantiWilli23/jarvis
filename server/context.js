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
import { createStudio } from "./studio.js";
import { createBrowser } from "./browser.js";
import { createApprovals } from "./approvals.js";
import { createAgent } from "./agent.js";
import { createAudit } from "./audit.js";
import { createPhoneQueue } from "./phone/queue.js";
import { createStt } from "./stt.js";
import { createChatService } from "./chat-service.js";
import { createTts } from "./tts.js";
import { createWebSearch } from "./tools/websearch.js";
import { createPro, claudeIds, loadProConfig } from "./pro/index.js";
import { buildExtensions } from "./extensions.js";
import { createDespertador } from "./phone/despertador.js";
import { createPush, loadWebPush } from "./push.js";

const cfgPath = (f) => fileURLToPath(new URL(`../config/${f}`, import.meta.url));
export const loadJson = (f) => JSON.parse(readFileSync(cfgPath(f), "utf8"));

export async function buildContext({ db, env = process.env, fetch: f, now = () => Date.now(), providers: providersOverride, webpush: webpushOverride } = {}) {
  const config = loadJson("providers.json");
  const permissions = loadJson("permissions.json");
  const persona = readFileSync(cfgPath("persona.md"), "utf8");
  const { fts } = await initSchema(db);
  const ownerId = await ensureOwner(db, { name: env.OWNER_NAME || "señor", password: env.OWNER_PASSWORD });

  const providers = providersOverride || buildProviders({ env, fetch: f, config });
  await providers.ollama?.probe?.(); // Ollama solo entra si responde
  const realChain = config.cadena_gratis.filter((id) => providers[id]?.enabled);
  const keyless = realChain.length === 0;
  const chain = keyless ? ["fake"] : realChain;
  const privacy = createPrivacy({ allowed: config.permite_privado, localSafe: [...(keyless ? ["fake"] : []), ...(providers.ollama?.enabled && providers.ollama.localSafe ? ["ollama"] : [])] });
  const limits = Object.fromEntries(Object.entries(config.proveedores).map(([id, p]) => [id, { rpm: p.limites?.rpm ?? null, rpd: p.limites?.rpd ?? null }]));
  const quota = createQuota({ db, limits, now });
  const bus = new EventEmitter();
  const state = { lastProvider: null, pc: { online: false } };
  bus.on("chat.done", ({ provider }) => { state.lastProvider = provider; });

  // Conexión en uso: el panel la pinta en rojo (conn.using) durante USING_MS tras cada llamada.
  const USING_MS = 6000;
  const usingAt = new Map();
  const markUsing = (id, userId) => { usingAt.set(id, now()); bus.emit("conn.using", { userId, id }); };
  const isUsing = (id) => now() - (usingAt.get(id) ?? -Infinity) < USING_MS;
  bus.on("pc.using", ({ userId, id = "claude_pc" }) => markUsing(id, userId)); // el orquestador Pro/PC avisa por aquí
  const router = createRouter({ providers, chain, orderByKind: config.orden_por_tipo, quota, privacy, onUse: (id, { userId } = {}) => markUsing(id, userId) });
  const notes = createNotes({ db, fts, now });
  const search = createSearch({ db, fts });
  const inbox = createInbox({ notes });
  const audit = createAudit({ db, now });
  const tasks = createTasks({ db, bus, now });
  const direct = createDirect({ tasks });
  const prepare = createPrepare({ router, tasks });
  const approvals = createApprovals({ db, bus, audit, now });
  const phone = createPhoneQueue({ db, bus, approvals, audit, config: loadJson("phone-actions.json"), now });
  const agent = createAgent({ db, bus, tasks, approvals, audit, permissions, state, motores: config.motores_pc, proModelos: () => claudeIds(loadProConfig()), now });
  const pro = createPro({ db, bus, agent, approvals, audit, permissions, now, quota, groq: () => providers.groq });
  const sessions = createSessions({ db, now });
  const limiter = createLoginLimiter({ db, now });
  const stt = createStt({ apiKey: env.GROQ_API_KEY, fetch: f });
  const websearch = createWebSearch({ providers, quota, config: config.busqueda, fetch: f, env, now });
  const chat = createChatService({ db, router, privacy, search, tasks, prepare, bus, phone, persona, webSearch: websearch, agent, now });
  let ext = null; // conectores de las fases 4-6 (se arman al final)
  const studio = createStudio({ db, config: config.estudio, providers, chat, privacy, now });
  const browser = createBrowser({ db, config: loadJson("browser-sites.json"), agent, chat, privacy, bus, audit, now });
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
    const puestos = config.puestos.map((p) => ({ id: p.id, nombre: p.nombre, rol: p.rol, pc: !!p.pc, estado: p.pc ? (agent.view().online ? "activo" : "pc_apagado") : (providers[p.proveedor || p.id]?.enabled ? "activo" : "apagado") }));
    const q = await tasks.counts(userId);
    const queue = (await tasks.list(userId)).filter((x) => ["pendiente", "por_revisar", "reclamada", "en_curso"].includes(x.status)).reverse()
      .map((x) => ({ id: x.id, seq: x.seq, mode: x.mode, engine: x.engine, status: x.status, text: x.text.slice(0, 200), pasos: x.prepared?.pasos?.length || 0, por: x.prepared?.por || null, at: x.created_at }));
    const lastSync = await get(db, "SELECT value FROM settings WHERE user_id=? AND key='ultima_sync_pc'", [userId]);
    const conn = (id, n, ok) => ({ id, nombre: n, ok: !!ok, usa: isUsing(id) });
    return {
      state: "idle", keyless, fts,
      providers: provs, puestos,
      memory: { ...(await notes.counts(userId)), ultima_sync_pc: lastSync?.value ? Number(lastSync.value) : null, bd: env.DATABASE_URL ? "Turso" : "local" },
      queue: { items: queue, total: queue.length, porEstado: q },
      pc: (agent.sweep(), agent.view()),
      connections: [conn("groq", "Groq", providers.groq?.enabled), conn("gemini", "Gemini", providers.gemini?.enabled), conn("openrouter", "OpenRouter", providers.openrouter?.enabled),
        conn("claude_pc", "Claude (PC)", agent.view().online), conn("telegram", "Telegram", !!env.TELEGRAM_BOT_TOKEN),
        conn("turso", "Turso", !!env.DATABASE_URL), conn("render", "Render", !!env.RENDER), conn("gmail", "Gmail", await ext?.google.connected(userId)), conn("calendar", "Calendar", await ext?.google.connected(userId)), conn("spotify", "Spotify", await ext?.spotify.connected(userId)),
        conn("juegos", "Juegos", ext?.games.enabled), conn("whatsapp", "WhatsApp", ext?.whatsapp.enabled)],
      pro: await pro.status(userId),
      pendientes_aprobacion: (await approvals.pending(userId)).length,
      voz: await tts.status(userId),
    };
  }

  const base = { db, env, config, permissions, persona, ownerId, providers, chain, keyless, privacy, quota, bus, state, router,
    notes, search, inbox, audit, tasks, direct, prepare, approvals, phone, agent, pro, sessions, limiter, stt, tts, studio, browser, chat, websearch, status, now, fts };
  ext = buildExtensions(base, { fetch: f });
  const despertador = createDespertador({ env, bus, audit, getGoogle: () => ext?.google, now });
  const push = createPush({ db, env, bus, audit, ownerId, webpush: webpushOverride === undefined ? await loadWebPush() : webpushOverride, now });
  return { ...base, ...ext, despertador, push };
}

export { all };
