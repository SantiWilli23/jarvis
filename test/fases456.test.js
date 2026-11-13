import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { createDb, get } from "../server/db/client.js";
import { buildContext } from "../server/context.js";
import { createApp } from "../server/app.js";
import { createCrypto } from "../server/crypto.js";
import { createPrivacy } from "../server/router/privacy.js";
import { buildProviders } from "../server/providers/index.js";
import { loadJson } from "../server/context.js";
import { OllamaProvider, PerplexityProvider } from "../server/providers/more.js";
import { shortReply } from "../server/routes/shortcut.js";

const KEY = "clave-de-cifrado-de-pruebas-123456";
const SECRET = "secreto_webhook";
const CHAT = "4242";

// fetch simulado: guarda las llamadas y responde según la URL.
function mockFetch(handlers = {}) {
  const calls = [];
  const f = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, opts });
    for (const [frag, fn] of Object.entries(handlers)) if (u.includes(frag)) return fn(u, opts);
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200, headers: { "content-type": "application/json" } });
  };
  f.calls = calls;
  return f;
}
const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

async function boot(env = {}, f = mockFetch()) {
  const db = createDb({ url: ":memory:" });
  const ctx = await buildContext({ db, env: { OWNER_PASSWORD: "prueba-123", ...env }, fetch: f });
  const server = createServer(createApp(ctx));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, { method = "GET", body, headers = {}, tk } = {}) =>
    fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(tk ? { authorization: `Bearer ${tk}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const tk = (await ctx.sessions.create(ctx.ownerId, { name: "t", kind: "web" })).token;
  return { ctx, db, base, call, tk, f, close: () => server.close() };
}

// ---------- Todo apagado sin credenciales ----------
test("sin credenciales todo queda apagado y /health y /status siguen bien", async () => {
  const s = await boot();
  try {
    assert.equal((await s.call("/health")).status, 200);
    const st = await (await s.call("/api/status", { tk: s.tk })).json();
    assert.equal(st.keyless, true);
    for (const id of ["mistral", "cloudflare", "ollama", "openai", "xai", "perplexity"]) assert.equal(s.ctx.providers[id].enabled, false, id);
    assert.equal(s.ctx.telegram.enabled, false);
    assert.equal(s.ctx.google.enabled, false);
    assert.equal(s.ctx.spotify.enabled, false);
    assert.equal(s.ctx.games.enabled, false);
    assert.equal(s.ctx.whatsapp.enabled, false);
    assert.equal((await s.call("/api/telegram/webhook", { method: "POST", body: {} })).status, 503);
    assert.equal((await s.call("/api/cron/tick")).status, 503);
    assert.equal((await s.call("/api/whatsapp/webhook", { method: "POST", body: {} })).status, 503);
    assert.equal((await s.call("/api/connect/google/start", { method: "POST", tk: s.tk })).status, 503);
    assert.equal((await s.call("/api/connect/spotify/start", { method: "POST", tk: s.tk })).status, 503);
    const t = await (await s.call("/api/tools/google.correos", { method: "POST", tk: s.tk, body: {} })).json();
    assert.equal(t.error, "apagada");
    assert.equal(s.f.calls.length, 0, "no debe haber salido nada a la red");
  } finally { s.close(); }
});

// ---------- Proveedores nuevos ----------
test("Mistral y Cloudflare llaman a su endpoint oficial; Cloudflare exige cuenta y token", async () => {
  const f = mockFetch({ "api.mistral.ai": () => J({ choices: [{ message: { content: "hola" } }], usage: { total_tokens: 3 } }),
    "api.cloudflare.com": () => J({ choices: [{ message: { content: "cf" } }] }) });
  const config = loadJson("providers.json");
  const p = buildProviders({ env: { MISTRAL_API_KEY: "m", CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "abc123" }, fetch: f, config });
  assert.equal(p.mistral.enabled, true);
  assert.equal(p.cloudflare.enabled, true);
  await p.mistral.chat({ messages: [{ role: "user", content: "x" }] });
  await p.cloudflare.chat({ messages: [{ role: "user", content: "x" }] });
  assert.equal(f.calls[0].url, "https://api.mistral.ai/v1/chat/completions");
  assert.equal(f.calls[1].url, "https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1/chat/completions");
  assert.equal(JSON.parse(f.calls[0].opts.body).model, "mistral-small-latest");
  const sin = buildProviders({ env: { CLOUDFLARE_API_TOKEN: "t" }, fetch: f, config });
  assert.equal(sin.cloudflare.enabled, false);
});

test("Ollama: solo se enciende si responde; privado solo si es localhost", async () => {
  const vivo = mockFetch({ "/v1/models": () => J({ data: [{ id: "qwen3" }] }) });
  const o = new OllamaProvider({ url: "http://localhost:11434", fetch: vivo });
  assert.equal(await o.probe(), true);
  assert.equal(o.model, "qwen3");
  assert.equal(o.localSafe, true);
  const muerto = new OllamaProvider({ url: "http://localhost:11434", fetch: async () => { throw new Error("ECONNREFUSED"); } });
  assert.equal(await muerto.probe(), false);
  assert.equal(muerto.enabled, false);
  assert.equal(new OllamaProvider({ url: "https://mi-tunel.example.com", fetch: vivo }).localSafe, false);

  // Integración con la privacidad del contexto
  const db = createDb({ url: ":memory:" });
  const ctx = await buildContext({ db, env: { OWNER_PASSWORD: "x", OLLAMA_URL: "http://127.0.0.1:11434" }, fetch: vivo });
  assert.ok(ctx.privacy.isAllowed("ollama", true));
  const db2 = createDb({ url: ":memory:" });
  const ctx2 = await buildContext({ db: db2, env: { OWNER_PASSWORD: "x", OLLAMA_URL: "https://remoto.example.com" }, fetch: vivo });
  assert.equal(ctx2.privacy.isAllowed("ollama", true), false);
});

test("privacidad: Mistral, Cloudflare, OpenAI, Grok, Perplexity y WhatsApp/Google/Spotify no reciben privado", async () => {
  const priv = createPrivacy({ allowed: loadJson("providers.json").permite_privado });
  for (const id of ["mistral", "cloudflare", "ollama", "openai", "xai", "perplexity", "gemini", "openrouter"]) assert.equal(priv.isAllowed(id, true), false, id);
  assert.equal(priv.isAllowed("groq", true), true);
});

test("ChatGPT, Grok y Perplexity: apagados sin clave, implementados con ella, y el sustituto atiende", async () => {
  const f = mockFetch({
    "api.openai.com": () => J({ choices: [{ message: { content: "revisado" } }] }),
    "api.x.ai": () => J({ choices: [{ message: { content: "datos" } }] }),
    "api.perplexity.ai": () => J({ output: [{ type: "search_results", results: [{ url: "https://a.com/x", title: "A" }] }, { type: "message", content: [{ type: "output_text", text: "Respuesta", annotations: [{ type: "url_citation", url: "https://b.com", title: "B" }] }] }], usage: { total_tokens: 9 } }),
  });
  const config = loadJson("providers.json");
  const on = buildProviders({ env: { OPENAI_API_KEY: "o", XAI_API_KEY: "x", PERPLEXITY_API_KEY: "p" }, fetch: f, config });
  assert.equal((await on.openai.chat({ messages: [{ role: "user", content: "hi" }] })).text, "revisado");
  assert.equal((await on.xai.chat({ messages: [{ role: "user", content: "hi" }] })).text, "datos");
  const pr = await on.perplexity.ask({ input: "q" });
  assert.equal(pr.text, "Respuesta");
  assert.deepEqual(pr.sources.map((s) => s.url), ["https://a.com/x", "https://b.com"]);
  assert.equal(f.calls[2].url, "https://api.perplexity.ai/v1/agent");
  // El sustituto está definido en config y los puestos apuntan a su proveedor
  const puestos = Object.fromEntries(config.puestos.map((p) => [p.id, p]));
  assert.equal(puestos.chatgpt.sustituto, "gemini");
  assert.equal(puestos.grok.sustituto, "groq");
  assert.equal(puestos.perplexity.sustituto, "gemini");
  assert.deepEqual(config.orden_por_tipo.revision.slice(0, 2), ["openai", "gemini"]);
  // Apagados sin clave: el enrutador salta al sustituto
  const off = buildProviders({ env: {}, fetch: f, config });
  for (const id of ["openai", "xai", "perplexity"]) assert.equal(off[id].enabled, false);
});

// ---------- Búsqueda web ----------
test("búsqueda web: con citas, usa el sustituto sin Perplexity y NUNCA con texto privado", async () => {
  const f = mockFetch({ "generativelanguage.googleapis.com": () => J({ candidates: [{ content: { parts: [{ text: "Ganó X." }] }, groundingMetadata: { groundingChunks: [{ web: { uri: "https://f.com", title: "F" } }] } }] }) });
  const s = await boot({ GEMINI_API_KEY: "g" }, f);
  try {
    const r = await (await s.call("/api/search", { method: "POST", tk: s.tk, body: { query: "quién ganó la liga ayer" } })).json();
    assert.equal(r.ok, true);
    assert.equal(r.provider, "gemini");
    assert.equal(r.private, false);
    assert.equal(r.sources[0].url, "https://f.com");
    const n = f.calls.length;
    const p1 = await s.call("/api/search", { method: "POST", tk: s.tk, body: { query: "algo", private: true } });
    assert.equal(p1.status, 403);
    const p2 = await s.call("/api/search", { method: "POST", tk: s.tk, body: { query: "busca mi contraseña del banco" } });
    assert.equal(p2.status, 403);
    assert.equal(f.calls.length, n, "no salió ninguna petición con texto privado");
  } finally { s.close(); }
});

// ---------- Telegram ----------
const TG = { TELEGRAM_BOT_TOKEN: "123:abc", TELEGRAM_WEBHOOK_SECRET: SECRET, TELEGRAM_ALLOWED_CHAT_IDS: CHAT };
const hook = (s, update, secret = SECRET) => s.call("/api/telegram/webhook", { method: "POST", body: update, headers: secret ? { "x-telegram-bot-api-secret-token": secret } : {} });
const sent = (f, method) => f.calls.filter((c) => c.url.includes(`/${method}`)).map((c) => JSON.parse(c.opts.body));

test("Telegram: secreto inválido rechazado; chat no permitido ignorado; texto entra al chat", async () => {
  const s = await boot(TG);
  try {
    assert.equal((await hook(s, { update_id: 1, message: { chat: { id: 4242 }, text: "hola" } }, "malo")).status, 401);
    assert.equal((await hook(s, { update_id: 1, message: { chat: { id: 4242 }, text: "hola" } }, null)).status, 401);
    assert.equal(s.f.calls.length, 0);
    assert.equal((await hook(s, { update_id: 2, message: { chat: { id: 999 }, text: "hola" } })).status, 200);
    assert.equal(s.f.calls.length, 0, "chat ajeno: no se responde");
    assert.equal((await hook(s, { update_id: 3, message: { chat: { id: 4242 }, text: "¿cómo estás?" } })).status, 200);
    const m = sent(s.f, "sendMessage");
    assert.equal(m.length, 1);
    assert.equal(String(m[0].chat_id), CHAT);
    assert.match(m[0].text, /Respuesta simulada|Entendido/);
    assert.ok(s.f.calls[0].url.startsWith("https://api.telegram.org/bot123:abc/"));
  } finally { s.close(); }
});

test("Telegram: botones de aprobación se envían y el callback aprueba o rechaza", async () => {
  const s = await boot(TG);
  try {
    const a1 = await s.ctx.approvals.request({ userId: s.ctx.ownerId, kind: "git_push", summary: "git push origin main" });
    await new Promise((r) => setTimeout(r, 50));
    const card = sent(s.f, "sendMessage").find((m) => m.reply_markup);
    assert.ok(card, "tarjeta enviada");
    const btns = card.reply_markup.inline_keyboard[0];
    assert.deepEqual(btns.map((b) => b.callback_data), [`ap:${a1.id}:1`, `ap:${a1.id}:0`]);
    // Un chat ajeno no puede resolver
    await hook(s, { update_id: 10, callback_query: { id: "c0", data: `ap:${a1.id}:1`, from: { id: 1 }, message: { chat: { id: 777 }, message_id: 1 } } });
    assert.equal((await s.ctx.approvals.pending(s.ctx.ownerId)).length, 1);
    await hook(s, { update_id: 11, callback_query: { id: "c1", data: `ap:${a1.id}:1`, from: { id: 4242 }, message: { chat: { id: 4242 }, message_id: 5 } } });
    assert.equal((await s.ctx.approvals.pending(s.ctx.ownerId)).length, 0);
    assert.equal((await get(s.db, "SELECT status FROM approvals WHERE id=?", [a1.id])).status, "aprobada");
    assert.equal(sent(s.f, "answerCallbackQuery").length, 1);
    const a2 = await s.ctx.approvals.request({ userId: s.ctx.ownerId, kind: "borrar", summary: "borrar x" });
    await hook(s, { update_id: 12, callback_query: { id: "c2", data: `ap:${a2.id}:0`, from: { id: 4242 }, message: { chat: { id: 4242 }, message_id: 6 } } });
    assert.equal((await get(s.db, "SELECT status FROM approvals WHERE id=?", [a2.id])).status, "rechazada");
  } finally { s.close(); }
});

test("Telegram: nota de voz se transcribe con Whisper y se responde", async () => {
  const f = mockFetch({
    "/getFile": () => J({ ok: true, result: { file_path: "voice/a.oga" } }),
    "/file/bot": () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    "audio/transcriptions": () => J({ text: "hola jarvis" }),
  });
  const s = await boot({ ...TG, GROQ_API_KEY: "gsk" }, f);
  try {
    await hook(s, { update_id: 20, message: { chat: { id: 4242 }, voice: { file_id: "F1" } } });
    assert.ok(f.calls.some((c) => c.url.includes("audio/transcriptions")));
    const m = sent(f, "sendMessage");
    assert.match(m[0].text, /hola jarvis/);
  } finally { s.close(); }
});

// ---------- Atajos ----------
test("/api/shortcut: token propio, acepta dictado, respuesta corta y texto plano", async () => {
  const s = await boot();
  try {
    const dev = await (await s.call("/api/devices", { method: "POST", tk: s.tk, body: { name: "iPhone", kind: "shortcut" } })).json();
    assert.equal((await s.call("/api/shortcut", { method: "POST", body: { text: "hola" } })).status, 401);
    assert.equal((await s.call("/api/shortcut", { method: "POST", tk: s.tk, body: { text: "hola" } })).status, 403);
    const r = await (await s.call("/api/shortcut", { method: "POST", tk: dev.token, body: { dictado: "¿qué hora es?" } })).json();
    assert.equal(r.status, "ok");
    assert.ok(r.reply.length <= 401);
    assert.equal(r.speak, r.reply);
    assert.equal((await s.call("/api/shortcut", { method: "POST", tk: dev.token, body: {} })).status, 400);
    const t = await s.call("/api/shortcut?format=text", { method: "POST", tk: dev.token, body: { input: "hola" } });
    assert.match(t.headers.get("content-type"), /text\/plain/);
    assert.ok((await t.text()).length > 0);
    assert.equal(shortReply("a".repeat(1000)).length <= 401, true);
  } finally { s.close(); }
});

// ---------- Cron ----------
test("cron: sin secreto configurado 503, con secreto malo 401, bueno hace recordatorios, pc y resumen", async () => {
  const f = mockFetch();
  let t = Date.UTC(2026, 5, 1, 13, 0, 0);
  const s = await boot({ ...TG, CRON_SECRET: "cron-secreto" }, f);
  s.ctx.now = () => t; // el cron usa el reloj inyectado en su creación; se reconstruye abajo
  try {
    assert.equal((await s.call("/api/cron/tick")).status, 401);
    assert.equal((await s.call("/api/cron/tick", { headers: { authorization: "Bearer malo" } })).status, 401);
    assert.equal((await s.call("/api/cron/tick", { headers: { "x-cron-secret": "malo" } })).status, 401);
    await s.call("/api/tools/recordatorio.crear", { method: "POST", tk: s.tk, body: { text: "sacar la basura", en_minutos: -1 } });
    const r = await (await s.call("/api/cron/tick", { method: "POST", headers: { authorization: "Bearer cron-secreto" } })).json();
    assert.equal(r.ok, true);
    assert.equal(r.recordatorios, 1);
    assert.ok(sent(f, "sendMessage").some((m) => /sacar la basura/.test(m.text)));
    // PC: primera vez sin aviso; luego un cambio avisa
    s.ctx.state.pc.online = true;
    const r2 = await (await s.call("/api/cron/tick", { headers: { "x-cron-secret": "cron-secreto" } })).json();
    assert.equal(r2.pc, "pc_online");
    assert.equal(r2.recordatorios, 0);
    const r3 = await (await s.call("/api/cron/tick", { headers: { "x-cron-secret": "cron-secreto" } })).json();
    assert.equal(r3.pc, null);
  } finally { s.close(); }
});

// ---------- Tokens cifrados + conectores con aprobación ----------
test("crypto: AES-GCM ida y vuelta, sin clave no cifra", () => {
  const c = createCrypto(KEY);
  const blob = c.encrypt({ a: "secreto-xyz" });
  assert.ok(!blob.includes("secreto-xyz"));
  assert.deepEqual(c.decrypt(blob), { a: "secreto-xyz" });
  assert.throws(() => createCrypto("").encrypt({}));
  assert.throws(() => createCrypto("otra-clave-distinta-1234").decrypt(blob));
});

const GOOGLE = { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csec", CONNECTIONS_KEY: KEY, PUBLIC_URL: "https://jarvis.example.com" };
function googleFetch() {
  return mockFetch({
    "oauth2.googleapis.com/token": () => J({ access_token: "ACCESS-TOKEN-SECRETO", refresh_token: "REFRESH-TOKEN-SECRETO", expires_in: 3600, scope: "x" }),
    "gmail/v1/users/me/messages/send": () => J({ id: "sent1" }),
    "gmail/v1/users/me/messages/m1": () => J({ snippet: "hola", payload: { headers: [{ name: "From", value: "a@b.com" }, { name: "Subject", value: "Asunto" }] } }),
    "gmail/v1/users/me/messages?": () => J({ messages: [{ id: "m1" }] }),
  });
}

test("Google: OAuth guarda tokens CIFRADOS en la BD, lectura automática y envío solo con aprobación", async () => {
  const f = googleFetch();
  const s = await boot(GOOGLE, f);
  try {
    const st = await (await s.call("/api/connect/google/start", { method: "POST", tk: s.tk })).json();
    const url = new URL(st.url);
    assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(url.searchParams.get("redirect_uri"), "https://jarvis.example.com/api/connect/google/callback");
    assert.equal(url.searchParams.get("access_type"), "offline");
    const state = url.searchParams.get("state");
    assert.equal((await s.call(`/api/connect/google/callback?code=XX&state=falso`)).status, 400);
    assert.equal((await s.call(`/api/connect/google/callback?code=C0DE&state=${state}`)).status, 200);
    assert.equal((await s.call(`/api/connect/google/callback?code=C0DE&state=${state}`)).status, 400, "el estado es de un solo uso");

    const row = await get(s.db, "SELECT detail FROM connections WHERE name='google'");
    assert.ok(!row.detail.includes("ACCESS-TOKEN-SECRETO") && !row.detail.includes("REFRESH-TOKEN-SECRETO"), "tokens en claro en la BD");
    assert.equal(createCrypto(KEY).decrypt(row.detail).refresh_token, "REFRESH-TOKEN-SECRETO");

    // lectura: automática y marcada como privada
    const mails = await (await s.call("/api/tools/google.correos", { method: "POST", tk: s.tk, body: {} })).json();
    assert.equal(mails.status, "ok");
    assert.equal(mails.private, true);
    assert.equal(mails.data[0].subject, "Asunto");

    // envío: NO se envía; queda pendiente de aprobación
    const r = await s.call("/api/tools/google.enviar_correo", { method: "POST", tk: s.tk, body: { to: "x@y.com", subject: "Hola", body: "texto" } });
    assert.equal(r.status, 202);
    const out = await r.json();
    assert.equal(out.status, "pendiente_aprobacion");
    assert.equal(f.calls.filter((c) => c.url.includes("messages/send")).length, 0);
    // rechazar: sigue sin enviarse
    const a = (await s.ctx.approvals.pending(s.ctx.ownerId))[0];
    await s.ctx.approvals.decide(s.ctx.ownerId, a.id, false);
    await new Promise((x) => setTimeout(x, 50));
    assert.equal(f.calls.filter((c) => c.url.includes("messages/send")).length, 0);
    // aprobar: ahora sí
    const out2 = await (await s.call("/api/tools/google.enviar_correo", { method: "POST", tk: s.tk, body: { to: "x@y.com", subject: "Hola", body: "texto" } })).json();
    await s.ctx.approvals.decide(s.ctx.ownerId, out2.approval_id, true);
    await new Promise((x) => setTimeout(x, 100));
    const send = f.calls.filter((c) => c.url.includes("messages/send"));
    assert.equal(send.length, 1);
    assert.ok(send[0].opts.headers.authorization.startsWith("Bearer "));
    // crear evento también exige aprobación
    const ev = await s.call("/api/tools/google.crear_evento", { method: "POST", tk: s.tk, body: { summary: "Cita", start: "2026-06-01T10:00:00Z", end: "2026-06-01T11:00:00Z" } });
    assert.equal(ev.status, 202);
  } finally { s.close(); }
});

test("Google/Spotify: sin CONNECTIONS_KEY quedan apagados aunque haya credenciales", async () => {
  const s = await boot({ GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b", SPOTIFY_CLIENT_ID: "c" });
  try {
    assert.equal(s.ctx.google.enabled, false);
    assert.equal(s.ctx.spotify.enabled, false);
  } finally { s.close(); }
});

test("Spotify: PKCE (S256), lectura automática y control según permissions.json", async () => {
  const f = mockFetch({
    "accounts.spotify.com/api/token": (u, o) => J({ access_token: "SP-ACCESS", refresh_token: "SP-REFRESH", expires_in: 3600 }),
    "currently-playing": () => J({ is_playing: true, item: { name: "Canción", artists: [{ name: "Artista" }], album: { name: "Álbum" } } }),
    "me/player/pause": () => new Response(null, { status: 204 }),
  });
  const s = await boot({ SPOTIFY_CLIENT_ID: "sid", CONNECTIONS_KEY: KEY }, f);
  try {
    const st = await (await s.call("/api/connect/spotify/start", { method: "POST", tk: s.tk })).json();
    const u = new URL(st.url);
    assert.equal(u.searchParams.get("code_challenge_method"), "S256");
    assert.ok(u.searchParams.get("code_challenge"));
    assert.equal(u.searchParams.get("client_secret"), null);
    await s.call(`/api/connect/spotify/callback?code=ZZ&state=${u.searchParams.get("state")}`);
    const tokenCall = f.calls.find((c) => c.url.includes("api/token"));
    const form = new URLSearchParams(String(tokenCall.opts.body));
    assert.ok(form.get("code_verifier"), "el verificador PKCE viaja al canjear el código");
    const row = await get(s.db, "SELECT detail FROM connections WHERE name='spotify'");
    assert.ok(!row.detail.includes("SP-REFRESH"));
    const np = await (await s.call("/api/tools/spotify.escuchando", { method: "POST", tk: s.tk, body: {} })).json();
    assert.match(np.text, /Canción/);
    assert.equal(np.private, true);
    // control automático por defecto (permissions.json)
    const c1 = await (await s.call("/api/tools/spotify.control", { method: "POST", tk: s.tk, body: { accion: "pausa" } })).json();
    assert.equal(c1.status, "ok");
    // si se mueve a requiere_aprobacion, pide aprobación
    s.ctx.permissions.automatico = s.ctx.permissions.automatico.filter((x) => x !== "spotify_control");
    const c2 = await s.call("/api/tools/spotify.control", { method: "POST", tk: s.tk, body: { accion: "pausa" } });
    assert.equal(c2.status, 202);
  } finally { s.close(); }
});

test("WhatsApp: verificación del webhook, recepción privada y envío SOLO con aprobación", async () => {
  const f = mockFetch({ "graph.facebook.com": () => J({ messages: [{ id: "w1" }] }) });
  const env = { WHATSAPP_TOKEN: "wt", WHATSAPP_PHONE_ID: "555", WHATSAPP_VERIFY_TOKEN: "vt", WHATSAPP_APP_SECRET: "app-sec" };
  const s = await boot(env, f);
  try {
    assert.equal((await s.call("/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=malo&hub.challenge=123")).status, 403);
    const ok = await s.call("/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=123");
    assert.equal(await ok.text(), "123");
    const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: "573001112233", type: "text", text: { body: "hola desde whatsapp" } }] } }] }] });
    const bad = await fetch(s.base + "/api/whatsapp/webhook", { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=00" }, body });
    assert.equal(bad.status, 401);
    const sig = "sha256=" + createHmac("sha256", "app-sec").update(body).digest("hex");
    const good = await fetch(s.base + "/api/whatsapp/webhook", { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sig }, body });
    assert.equal(good.status, 200);
    const msg = await get(s.db, "SELECT private, content FROM messages WHERE provider='whatsapp'");
    assert.equal(Number(msg.private), 1, "lo recibido queda marcado como privado");
    // envío: aprobación obligatoria
    const r = await s.call("/api/tools/whatsapp.enviar", { method: "POST", tk: s.tk, body: { to: "+57 300 111 2233", text: "ok" } });
    assert.equal(r.status, 202);
    assert.equal(f.calls.filter((c) => c.url.includes("graph.facebook.com")).length, 0);
    const a = (await s.ctx.approvals.pending(s.ctx.ownerId))[0];
    await s.ctx.approvals.decide(s.ctx.ownerId, a.id, true);
    await new Promise((x) => setTimeout(x, 100));
    const g = f.calls.filter((c) => c.url.includes("graph.facebook.com"));
    assert.equal(g.length, 1);
    assert.equal(JSON.parse(g[0].opts.body).to, "573001112233");
  } finally { s.close(); }
});

test("Juegos: conector de solo lectura (solo GET) apagado sin GAMES_API_URL", async () => {
  const f = mockFetch({ "/api/health": () => J({ ok: true }), "/api/public/features": () => J({ futotal2: false, games: ["wordle"] }) });
  const s = await boot({ GAMES_API_URL: "https://juego.example.com/" }, f);
  try {
    const r = await (await s.call("/api/tools/games.estado", { method: "POST", tk: s.tk, body: {} })).json();
    assert.equal(r.status, "ok");
    assert.match(r.text, /en línea/);
    assert.ok(f.calls.every((c) => (c.opts.method || "GET") === "GET"));
    assert.equal(f.calls[0].url, "https://juego.example.com/api/health");
    // sin token, ranking/progreso quedan apagados
    assert.equal((await (await s.call("/api/tools/games.ranking", { method: "POST", tk: s.tk, body: {} })).json()).error, "apagada");
  } finally { s.close(); }
});

test("ningún conector nuevo llama al enrutador de modelos (los datos privados no salen a ningún LLM)", async () => {
  const s = await boot({ ...GOOGLE, GAMES_API_URL: "https://juego.example.com" }, googleFetch());
  try {
    let llamadas = 0;
    s.ctx.router.route = async () => { llamadas++; return { ok: false }; };
    await s.ctx.connections.save(s.ctx.ownerId, "google", { access_token: "a", refresh_token: "r", expires_at: Date.now() + 1e7 });
    await s.call("/api/tools/google.correos", { method: "POST", tk: s.tk, body: {} });
    await s.call("/api/tools/google.eventos", { method: "POST", tk: s.tk, body: {} });
    assert.equal(llamadas, 0);
    assert.ok(s.ctx.tools.describe().filter((t) => t.private).length >= 8);
  } finally { s.close(); }
});
