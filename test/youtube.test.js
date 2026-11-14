import { test } from "node:test";
import assert from "node:assert/strict";
import { memDb, clock } from "./helpers.js";
import { get } from "../server/db/client.js";
import { createCrypto } from "../server/crypto.js";
import { createConnections } from "../server/connections.js";
import { createGoogle, YOUTUBE_SCOPE } from "../server/connectors/google.js";
import { createYouTube, nextPacificMidnight, ptDay } from "../server/connectors/youtube.js";

const SC = "https://www.googleapis.com/auth/gmail.readonly";
const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

async function setup({ scope = `${SC} ${YOUTUBE_SCOPE}`, handlers = {}, cfg = {}, env = true } = {}) {
  const { db, userId } = await memDb();
  const now = clock();
  const crypto = createCrypto("clave-de-cifrado-de-pruebas-123456");
  const connections = createConnections({ db, crypto, now });
  const calls = [];
  const f = async (url, opts = {}) => {
    const u = String(url); calls.push({ url: u, opts });
    for (const [frag, fn] of Object.entries(handlers)) if (u.includes(frag)) return fn(u, opts);
    return J({ items: [] });
  };
  const google = createGoogle({ env: env ? { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "sec" } : {}, fetch: f, connections, crypto, now });
  if (scope !== null) await connections.save(userId, "google", { access_token: "TOK", refresh_token: "R", expires_at: now() + 3_600_000, scope });
  const yt = createYouTube({ google, db, crypto, config: cfg, fetch: f, now });
  return { db, userId, now, crypto, google, yt, calls, connections };
}

test("authUrl pide youtube.readonly e include_granted_scopes", async () => {
  const s = await setup({ scope: null });
  const u = new URL(s.google.authUrl({ state: "x", redirectUri: "http://l/cb" }));
  assert.ok(u.searchParams.get("scope").includes(YOUTUBE_SCOPE));
  assert.equal(u.searchParams.get("include_granted_scopes"), "true");
});

test("token sin scope de YouTube: falta_permiso_youtube sin red", async () => {
  const s = await setup({ scope: SC });
  assert.deepEqual(await s.yt.ready(s.userId), { conectado: true, permiso: false });
  await assert.rejects(s.yt.playlists(s.userId), { code: "falta_permiso_youtube" });
  assert.equal(s.calls.length, 0);
});

test("sin conexión: no_conectado; sin credenciales: apagado", async () => {
  const s = await setup({ scope: null });
  await assert.rejects(s.yt.playlists(s.userId), { code: "no_conectado" });
  const o = await setup({ env: false });
  assert.equal(o.yt.enabled, false);
});

const PL = (page) => page === "2"
  ? { items: [{ id: "PL2", snippet: { title: "Rock" }, contentDetails: { itemCount: 3 } }] }
  : { nextPageToken: "2", items: [{ id: "PL1", snippet: { title: "Gym &amp; más" }, contentDetails: { itemCount: 9 } }] };

test("playlists: mine=true, Bearer, paginación, 'Me gusta' y caché", async () => {
  const s = await setup({ handlers: {
    "/playlists?": (u) => J(PL(new URL(u).searchParams.get("pageToken"))),
    "/channels?": () => J({ items: [{ contentDetails: { relatedPlaylists: { likes: "LL123" } } }] }),
  } });
  const r = await s.yt.playlists(s.userId);
  assert.deepEqual(r.map((x) => x.id), ["PL1", "PL2", "LL123"]);
  assert.equal(r[0].titulo, "Gym & más");
  const c = s.calls[0];
  assert.match(c.url, /mine=true/); assert.equal(c.opts.headers.authorization, "Bearer TOK");
  assert.equal(s.calls.length, 3);
  await s.yt.playlists(s.userId);
  assert.equal(s.calls.length, 3, "caché");
  assert.equal((await s.yt.usage(s.userId)).unidades, 3);
});

test("items: descarta borrados, privados y no incrustables", async () => {
  const s = await setup({ handlers: {
    "/playlistItems?": () => J({ items: [
      { snippet: { title: "Bueno", videoOwnerChannelTitle: "A - Topic", resourceId: { videoId: "v1" } }, status: { privacyStatus: "public" } },
      { snippet: { title: "Deleted video", resourceId: { videoId: "v2" } } },
      { snippet: { title: "Priv", resourceId: { videoId: "v3" } }, status: { privacyStatus: "private" } },
      { snippet: { title: "NoEmbed", resourceId: { videoId: "v4" } }, status: { privacyStatus: "public" } },
    ] }),
    "/videos?": () => J({ items: [{ id: "v1", status: { embeddable: true, privacyStatus: "public" } }, { id: "v4", status: { embeddable: false, privacyStatus: "public" } }] }),
  } });
  assert.deepEqual(await s.yt.items(s.userId, "PL1"), [{ id: "v1", titulo: "Bueno", canal: "A" }]);
});

test("search: parámetros, tope de 5, caché y unidades (+100)", async () => {
  const s = await setup({ handlers: { "/search?": () => J({ items: [{ id: { videoId: "a" }, snippet: { title: "T", channelTitle: "C" } }] }) } });
  const r = await s.yt.search(s.userId, { q: "Despacito", max: 99 });
  assert.deepEqual(r, [{ id: "a", titulo: "T", canal: "C" }]);
  const u = new URL(s.calls[0].url).searchParams;
  assert.equal(u.get("type"), "video"); assert.equal(u.get("videoEmbeddable"), "true"); assert.equal(u.get("videoCategoryId"), "10"); assert.equal(u.get("maxResults"), "5");
  assert.equal((await s.yt.usage(s.userId)).unidades, 100);
  await s.yt.search(s.userId, { q: "  despacito " });
  assert.equal(s.calls.length, 1);
});

test("el día de cuota cambia a medianoche del Pacífico", async () => {
  const s = await setup({ handlers: { "/search?": () => J({ items: [] }) } });
  await s.yt.search(s.userId, { q: "uno" });
  assert.equal((await s.yt.usage(s.userId)).unidades, 100);
  const next = nextPacificMidnight(s.now());
  assert.notEqual(ptDay(next - 1000), ptDay(next));
  s.now.advance(next - s.now() + 1000);
  assert.equal((await s.yt.usage(s.userId)).unidades, 0);
});

test("el tope propio corta sin red", async () => {
  const s = await setup({ cfg: { tope_unidades_dia: 150 }, handlers: { "/search?": () => J({ items: [] }) } });
  await s.yt.search(s.userId, { q: "a" });
  await assert.rejects(s.yt.search(s.userId, { q: "b" }), { code: "sin_cuota_youtube" });
  assert.equal(s.calls.length, 1);
});

test("403 quotaExceeded pausa hasta la medianoche del Pacífico", async () => {
  const s = await setup({ handlers: { "/playlists?": () => J({ error: { code: 403, errors: [{ reason: "quotaExceeded" }] } }, 403) } });
  await assert.rejects(s.yt.playlists(s.userId), { code: "sin_cuota_youtube" });
  const st = await get(s.db, "SELECT paused_until FROM provider_state WHERE user_id=? AND provider='youtube'", [s.userId]);
  assert.equal(st.paused_until, nextPacificMidnight(s.now()));
  const n = s.calls.length;
  await assert.rejects(s.yt.playlists(s.userId), { code: "sin_cuota_youtube" });
  assert.equal(s.calls.length, n);
});

test("la caché va cifrada y purge la borra", async () => {
  const s = await setup({ handlers: { "/search?": () => J({ items: [{ id: { videoId: "a" }, snippet: { title: "TituloSecreto", channelTitle: "C" } }] }) } });
  await s.yt.search(s.userId, { q: "cancion secreta" });
  const rows = (await s.db.execute("SELECT key, value FROM settings WHERE key LIKE 'yt:%'")).rows;
  assert.equal(rows.length, 1);
  assert.ok(!JSON.stringify(rows).includes("TituloSecreto") && !JSON.stringify(rows).includes("secreta"));
  assert.equal(await s.yt.purge(s.userId), 1);
  assert.equal((await s.db.execute("SELECT 1 FROM settings WHERE key LIKE 'yt:%'")).rows.length, 0);
});
