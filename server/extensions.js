// Piezas de las fases 4 a 6 (Telegram, cron, conectores, herramientas). Se arman aparte para no
// tocar el resto del contexto. Todo queda apagado si falta su credencial.
import { createCrypto } from "./crypto.js";
import { createConnections } from "./connections.js";
import { createOAuthStates } from "./oauth-state.js";
import { createTelegram } from "./connectors/telegram.js";
import { createGoogle } from "./connectors/google.js";
import { createSpotify } from "./connectors/spotify.js";
import { createGames } from "./connectors/games.js";
import { createWhatsApp } from "./connectors/whatsapp.js";
import { createTools } from "./tools/index.js";
import { createCron } from "./cron.js";

export function buildExtensions(ctx, { fetch: f } = {}) {
  const { db, env, now, bus } = ctx;
  const crypto = createCrypto(env.CONNECTIONS_KEY);
  const connections = createConnections({ db, crypto, now });
  const oauthStates = createOAuthStates({ db, now });
  const telegram = createTelegram({ env, fetch: f, chat: ctx.chat, stt: ctx.stt, approvals: ctx.approvals, bus, ownerId: ctx.ownerId, audit: ctx.audit,
    tools: { run: (x) => tools.run(x) } });
  const notify = (text, extra) => telegram.notify(text, extra);
  const google = createGoogle({ env, fetch: f, connections, crypto, now });
  const spotify = createSpotify({ env, fetch: f, connections, crypto, now });
  const games = createGames({ env, fetch: f });
  const whatsapp = createWhatsApp({ env, fetch: f, db, notify, ownerId: ctx.ownerId, now });
  const tools = createTools({ db, approvals: ctx.approvals, audit: ctx.audit, bus, permissions: ctx.permissions, websearch: ctx.websearch,
    google, spotify, games, whatsapp, phone: ctx.phone, notify, status: ctx.status, now });
  const cron = createCron({ db, notify, state: ctx.state, status: ctx.status, ownerId: ctx.ownerId, env, now, bus, proWeb: ctx.pro.orch.web });
  return { crypto, connections, oauthStates, telegram, notify, google, spotify, games, whatsapp, tools, cron };
}
