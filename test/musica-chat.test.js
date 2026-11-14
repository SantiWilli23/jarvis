import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createDb, all } from "../server/db/client.js";
import { buildContext } from "../server/context.js";
import { createApp } from "../server/app.js";
import { setModo } from "../server/settings.js";
import { spy } from "./helpers.js";

const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const ENV = { OWNER_PASSWORD: "prueba-123", GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "sec", CONNECTIONS_KEY: "clave-de-cifrado-de-pruebas-123456" };

async function boot({ scope = "https://www.googleapis.com/auth/youtube.readonly", quota = false, conectar = true, env = ENV } = {}) {
  const calls = [];
  const f = async (url) => {
    const u = String(url); calls.push(u);
    if (quota) return J({ error: { errors: [{ reason: "quotaExceeded" }] } }, 403);
    if (u.includes("/playlists?")) return J({ items: [{ id: "PL1", snippet: { title: "Gym" }, contentDetails: { itemCount: 2 } }, { id: "PL2", snippet: { title: "Rock clásico" }, contentDetails: { itemCount: 1 } }] });
    if (u.includes("/channels?")) return J({ items: [] });
    if (u.includes("/playlistItems?")) return J({ items: [1, 2].map((i) => ({ snippet: { title: `Tema ${i}`, videoOwnerChannelTitle: "Cant", resourceId: { videoId: `v${i}` } }, status: { privacyStatus: "public" } })) });
    if (u.includes("/videos?")) return J({ items: [1, 2].map((i) => ({ id: `v${i}`, status: { embeddable: true, privacyStatus: "public" } })) });
    if (u.includes("/search?")) return J({ items: [{ id: { videoId: "s1" }, snippet: { title: "Despacito", channelTitle: "Luis" } }] });
    return J({});
  };
  const groq = spy("groq");
  const db = createDb({ url: ":memory:" });
  const ctx = await buildContext({ db, env, fetch: f, providers: { groq } });
  if (conectar) await ctx.connections.save(ctx.ownerId, "google", { access_token: "T", refresh_token: "R", expires_at: Date.now() + 3_600_000, scope });
  const server = createServer(createApp(ctx));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const tk = (await ctx.sessions.create(ctx.ownerId, { name: "t", kind: "web" })).token;
  const call = (path, { method = "GET", body } = {}) => fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), authorization: `Bearer ${tk}` }, body: body ? JSON.stringify(body) : undefined });
  const chat = async (text, extra = {}) => (await call("/api/chat", { method: "POST", body: { text, ...extra } })).json();
  return { ctx, calls, groq, call, chat, close: () => server.close() };
}

test("ponme mi playlist gym: música con pistas, mensajes privados y ningún modelo", async () => {
  const s = await boot();
  try {
    const d = await s.chat("ponme mi playlist gym");
    assert.equal(d.status, "musica"); assert.equal(d.private, true);
    assert.equal(d.musica.op, "play"); assert.equal(d.musica.fuente, "playlist"); assert.equal(d.musica.index, 0);
    assert.deepEqual(d.musica.items.map((x) => x.id), ["v1", "v2"]);
    assert.match(d.musica.abrir, /music\.youtube\.com\/watch\?v=v1&list=PL1/);
    assert.equal(s.groq.calls, 0);
    const m = await all(s.ctx.db, "SELECT private FROM messages");
    assert.ok(m.length === 2 && m.every((x) => Number(x.private) === 1));
  } finally { s.close(); }
});

test("pausa la música sin reproductor sigue a la cola del teléfono; con reproductor activo es música", async () => {
  const s = await boot();
  try {
    const a = await s.chat("pausa la música", { origen: "movil" });
    assert.equal(a.status, "telefono");
    const b = await s.chat("pausa la música", { reproductor: { activo: true } });
    assert.equal(b.status, "musica"); assert.equal(b.musica.op, "pause");
    assert.equal(s.groq.calls, 0);
  } finally { s.close(); }
});

test("pon X ambiguo: solo si X es una playlist o el reproductor está activo", async () => {
  const s = await boot();
  try {
    await s.chat("qué playlists tengo"); // llena la caché de playlists
    assert.equal((await s.chat("pon gym")).status, "musica");
    assert.notEqual((await s.chat("pon atención al camino")).status, "musica");
  } finally { s.close(); }
});

test("modo Chat: no se maneja música", async () => {
  const s = await boot();
  try {
    await setModo(s.ctx.db, s.ctx.ownerId, "chat");
    const d = await s.chat("ponme mi playlist gym");
    assert.notEqual(d.status, "musica");
    assert.equal(s.calls.length, 0);
  } finally { s.close(); }
});

test("sin cuota: responde con enlace de búsqueda", async () => {
  const s = await boot({ quota: true });
  try {
    const d = await s.chat("reproduce Despacito");
    assert.equal(d.status, "musica");
    assert.match(d.musica.abrir, /^https:\/\/music\.youtube\.com\/search\?q=despacito/);
  } finally { s.close(); }
});

test("desde el Atajo solo texto, sin reproductor", async () => {
  const s = await boot();
  try {
    const d = await s.ctx.chat.handle({ userId: s.ctx.ownerId, text: "reproduce Despacito", source: "atajo" });
    assert.equal(d.status, "musica"); assert.equal(d.musica, null); assert.match(d.reply, /Ábralo/);
    assert.equal(s.calls.length, 0);
  } finally { s.close(); }
});

test("herramientas: flags private, formato, /connect y purga al desconectar", async () => {
  const s = await boot();
  try {
    const t = await (await s.call("/api/tools")).json();
    const y = Object.fromEntries(t.tools.filter((x) => x.name.startsWith("youtube.")).map((x) => [x.name, x]));
    assert.deepEqual(Object.keys(y).sort(), ["youtube.buscar", "youtube.cuota", "youtube.mis_playlists", "youtube.playlist"]);
    assert.equal(y["youtube.buscar"].private, false); assert.equal(y["youtube.cuota"].private, false);
    assert.equal(y["youtube.mis_playlists"].private, true); assert.equal(y["youtube.playlist"].private, true);
    const pl = await (await s.call("/api/tools/youtube.playlist", { method: "POST", body: { nombre: "gym" } })).json();
    assert.equal(pl.status, "ok"); assert.equal(pl.items.length, 2); assert.equal(pl.private, true);
    const b = await (await s.call("/api/tools/youtube.buscar", { method: "POST", body: { q: "despacito", max: 9 } })).json();
    assert.equal(b.items[0].id, "s1"); assert.equal(b.private, false);
    const q = await (await s.call("/api/tools/youtube.cuota", { method: "POST", body: {} })).json();
    assert.equal(q.unidades, 104); // search 100 + playlists, channels, playlistItems, videos
    const c = await (await s.call("/api/connect")).json();
    assert.deepEqual(c.youtube, { disponible: true, permiso: true, unidades_hoy: 104, tope: 8000 });
    assert.ok((await all(s.ctx.db, "SELECT 1 FROM settings WHERE key LIKE 'yt:%'")).length > 0);
    await s.call("/api/connect/google", { method: "DELETE" });
    assert.equal((await all(s.ctx.db, "SELECT 1 FROM settings WHERE key LIKE 'yt:%'")).length, 0);
  } finally { s.close(); }
});

test("sin credenciales las herramientas están apagadas y no hay llamadas", async () => {
  const s = await boot({ env: { OWNER_PASSWORD: "prueba-123" }, conectar: false });
  try {
    const r = await s.call("/api/tools/youtube.buscar", { method: "POST", body: { q: "x" } });
    assert.equal(r.status, 400); assert.equal((await r.json()).error, "apagada");
    assert.equal((await (await s.call("/api/connect")).json()).youtube.disponible, false);
    assert.notEqual((await s.chat("reproduce Despacito")).status, "musica");
    assert.equal(s.calls.length, 0);
  } finally { s.close(); }
});
