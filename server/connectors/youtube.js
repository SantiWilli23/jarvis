// Conector YouTube (YouTube Data API v3), SOLO LECTURA, para la música de Jarvis.
// Usa el token de Google (mismo OAuth) con el alcance youtube.readonly. Cuota diaria de 10.000 unidades
// (search = 100, el resto = 1); Jarvis se pone un tope propio y cuenta en provider_usage ('youtube').
// La caché (playlists, pistas, búsquedas) va cifrada en `settings` y se puede borrar entera con purge().
import { createHash } from "node:crypto";
import { all, get, run } from "../db/client.js";

export const YT_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
const API = "https://www.googleapis.com/youtube/v3";
const PROVIDER = "youtube";
const TZ = "America/Los_Angeles"; // la cuota de YouTube se reinicia a medianoche del Pacífico
const DAY = 86_400_000, HOUR = 3_600_000, MAX_TTL = 30 * DAY;
const COST = { search: 100, read: 1 };

const DEFAULTS = { tope_unidades_dia: 8000, max_busquedas_dia: 50, cache_busqueda_dias: 7, cache_playlists_horas: 12, cache_pistas_horas: 6, max_pistas: 200 };

export const normQ = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const decode = (s) => String(s ?? "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const err = (code, extra) => Object.assign(new Error(code), { code, ...(extra || {}) });

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
export const ptDay = (t) => fmt.format(new Date(t));
// Próxima medianoche del Pacífico (ms epoch): búsqueda binaria del instante en que cambia el día.
export function nextPacificMidnight(t) {
  const d0 = ptDay(t);
  let lo = t, hi = t + 26 * HOUR;
  while (hi - lo > 1000) { const mid = Math.floor((lo + hi) / 2); if (ptDay(mid) === d0) lo = mid; else hi = mid; }
  return hi;
}

export function createYouTube({ google, db, crypto, config = {}, fetch: f = globalThis.fetch, now = () => Date.now() }) {
  const cfg = { ...DEFAULTS, ...(config || {}) };
  const enabled = !!google?.enabled && !!crypto?.enabled;

  // ---------- caché cifrada (tabla settings, claves yt:*) ----------
  const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 24);
  async function cacheGet(userId, key) {
    const r = await get(db, "SELECT value FROM settings WHERE user_id=? AND key=?", [userId, key]);
    if (!r?.value) return null;
    try { const o = crypto.decrypt(r.value); return o.exp > now() ? o.data : null; } catch { return null; }
  }
  async function prune(userId) {
    for (const r of await all(db, "SELECT key, value FROM settings WHERE user_id=? AND key LIKE 'yt:%'", [userId])) {
      let vivo = false;
      try { vivo = crypto.decrypt(r.value).exp > now(); } catch { /* ilegible: se borra */ }
      if (!vivo) await run(db, "DELETE FROM settings WHERE user_id=? AND key=?", [userId, r.key]);
    }
  }
  async function cachePut(userId, key, data, ttl) {
    const exp = now() + Math.min(ttl, MAX_TTL);
    await run(db, "INSERT INTO settings (user_id, key, value, created_at) VALUES (?,?,?,?) ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value", [userId, key, crypto.encrypt({ exp, data }), now()]);
    await prune(userId);
  }

  // ---------- cuota ----------
  const dayKey = () => `pt:${ptDay(now())}`;
  async function usage(userId) {
    const r = await get(db, "SELECT tokens FROM provider_usage WHERE user_id=? AND provider=? AND window_key=?", [userId, PROVIDER, dayKey()]);
    const s = await get(db, "SELECT paused_until FROM provider_state WHERE user_id=? AND provider=?", [userId, PROVIDER]);
    return { unidades: Number(r?.tokens || 0), tope: cfg.tope_unidades_dia, pausado_hasta: s?.paused_until && s.paused_until > now() ? Number(s.paused_until) : null };
  }
  async function searchesToday(userId) {
    const r = await get(db, "SELECT count FROM provider_usage WHERE user_id=? AND provider=? AND window_key=?", [userId, PROVIDER, `${dayKey()}:search`]);
    return Number(r?.count || 0);
  }
  const bump = (userId, key, count, tokens) => run(db, `INSERT INTO provider_usage (user_id, provider, window_key, count, tokens, created_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(user_id, provider, window_key) DO UPDATE SET count = count + excluded.count, tokens = tokens + excluded.tokens`, [userId, PROVIDER, key, count, tokens, now()]);
  async function pause(userId, until, why) {
    const cur = await get(db, "SELECT 1 AS x FROM provider_state WHERE user_id=? AND provider=?", [userId, PROVIDER]);
    if (cur) await run(db, "UPDATE provider_state SET paused_until=?, last_error=?, updated_at=? WHERE user_id=? AND provider=?", [until, why, now(), userId, PROVIDER]);
    else await run(db, "INSERT INTO provider_state (user_id, provider, paused_until, last_error, created_at, updated_at) VALUES (?,?,?,?,?,?)", [userId, PROVIDER, until, why, now(), now()]);
  }

  // ---------- red ----------
  async function ready(userId) {
    if (!enabled) return { conectado: false, permiso: false };
    const conectado = await google.connected(userId);
    if (!conectado) return { conectado: false, permiso: false };
    const sc = await google.grantedScopes(userId);
    return { conectado: true, permiso: !!sc?.includes(YT_SCOPE) };
  }
  async function yfetch(userId, path, params, cost) {
    if (!enabled) throw err("no_conectado");
    const sc = await google.grantedScopes(userId);
    if (!sc) throw err("no_conectado");
    if (!sc.includes(YT_SCOPE)) throw err("falta_permiso_youtube");
    const u = await usage(userId);
    if (u.pausado_hasta || u.unidades + cost > u.tope) throw err("sin_cuota_youtube", { hasta: u.pausado_hasta || nextPacificMidnight(now()) });
    const token = await google.accessToken(userId);
    await bump(userId, dayKey(), 1, cost); // YouTube cobra aunque la respuesta falle
    const res = await f(`${API}/${path}?${new URLSearchParams(params)}`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) {
      let body = null; try { body = await res.json(); } catch { /* sin cuerpo */ }
      const reason = body?.error?.errors?.[0]?.reason || body?.error?.status || "";
      if (res.status === 403 && /quota/i.test(reason)) {
        const hasta = nextPacificMidnight(now());
        await pause(userId, hasta, "quotaExceeded");
        throw err("sin_cuota_youtube", { hasta });
      }
      if (res.status === 403 && /insufficient|scope/i.test(reason + (body?.error?.message || ""))) throw err("falta_permiso_youtube");
      if (res.status === 404) throw err("no_encontrado");
      throw err("google_http", { status: res.status, detalle: body?.error?.message || reason });
    }
    return res.json();
  }

  // ---------- lecturas ----------
  async function playlists(userId) {
    const hit = await cacheGet(userId, "yt:playlists");
    if (hit) return hit;
    const out = [];
    let page = "";
    do {
      const j = await yfetch(userId, "playlists", { part: "snippet,contentDetails", mine: "true", maxResults: "50", fields: "nextPageToken,items(id,snippet/title,contentDetails/itemCount)", ...(page ? { pageToken: page } : {}) }, COST.read);
      for (const p of j.items || []) out.push({ id: p.id, titulo: decode(p.snippet?.title), n: p.contentDetails?.itemCount ?? null });
      page = j.nextPageToken || "";
    } while (page);
    try {
      const c = await yfetch(userId, "channels", { part: "contentDetails", mine: "true", fields: "items/contentDetails/relatedPlaylists/likes" }, COST.read);
      out.push({ id: c.items?.[0]?.contentDetails?.relatedPlaylists?.likes || "LL", titulo: "Me gusta", n: null });
    } catch (e) { if (e.code === "sin_cuota_youtube" || e.code === "falta_permiso_youtube") throw e; }
    await cachePut(userId, "yt:playlists", out, cfg.cache_playlists_horas * HOUR);
    return out;
  }

  async function items(userId, playlistId, { max } = {}) {
    const id = String(playlistId || "");
    if (!/^[\w-]{2,64}$/.test(id)) throw err("no_encontrado");
    const lim = Math.min(Number(max) || cfg.max_pistas, cfg.max_pistas);
    const key = `yt:items:${id}`;
    const hit = await cacheGet(userId, key);
    if (hit) return hit.slice(0, lim);
    const crudo = [];
    let page = "";
    do {
      const j = await yfetch(userId, "playlistItems", { part: "snippet,status", playlistId: id, maxResults: "50", fields: "nextPageToken,items(snippet(title,videoOwnerChannelTitle,resourceId/videoId),status/privacyStatus)", ...(page ? { pageToken: page } : {}) }, COST.read);
      for (const it of j.items || []) {
        const vid = it.snippet?.resourceId?.videoId, titulo = decode(it.snippet?.title);
        if (!vid || /^(deleted|private) video$/i.test(titulo) || it.status?.privacyStatus === "private") continue;
        crudo.push({ id: vid, titulo, canal: decode(it.snippet?.videoOwnerChannelTitle || "").replace(/ - Topic$/, "") });
      }
      page = j.nextPageToken || "";
    } while (page && crudo.length < lim);
    // Solo lo que se puede reproducir incrustado
    const buenos = new Set();
    const lote = crudo.slice(0, lim);
    for (let i = 0; i < lote.length; i += 50) {
      const ids = lote.slice(i, i + 50).map((x) => x.id).join(",");
      const v = await yfetch(userId, "videos", { part: "status", id: ids, fields: "items(id,status(embeddable,privacyStatus))" }, COST.read);
      for (const x of v.items || []) if (x.status?.embeddable && x.status?.privacyStatus !== "private") buenos.add(x.id);
    }
    const out = lote.filter((x) => buenos.has(x.id));
    await cachePut(userId, key, out, cfg.cache_pistas_horas * HOUR);
    return out;
  }

  // Busca una canción por título en las pistas ya guardadas (gratis): { playlist, index, items } o null
  async function buscarEnCache(userId, q) {
    const words = normQ(q).split(" ").filter(Boolean);
    if (!words.length) return null;
    for (const r of await all(db, "SELECT key, value FROM settings WHERE user_id=? AND key LIKE 'yt:items:%'", [userId])) {
      let o; try { o = crypto.decrypt(r.value); } catch { continue; }
      if (o.exp <= now()) continue;
      const index = o.data.findIndex((x) => { const t = normQ(`${x.titulo} ${x.canal}`); return words.every((w) => t.includes(w)); });
      if (index >= 0) return { playlist: r.key.slice("yt:items:".length), index, items: o.data };
    }
    return null;
  }

  async function search(userId, { q, max = 5 } = {}) {
    const query = String(q ?? "").trim().slice(0, 120);
    if (!query) throw err("no_encontrado");
    const key = `yt:search:${hash(normQ(query))}`;
    const hit = await cacheGet(userId, key);
    if (hit) return hit;
    if ((await searchesToday(userId)) >= cfg.max_busquedas_dia) throw err("sin_cuota_youtube", { hasta: nextPacificMidnight(now()), por: "busquedas" });
    const n = Math.min(Math.max(Number(max) || 5, 1), 5);
    const j = await yfetch(userId, "search", { part: "snippet", type: "video", videoCategoryId: "10", videoEmbeddable: "true", maxResults: String(n), q: query, fields: "items(id/videoId,snippet(title,channelTitle))" }, COST.search);
    await bump(userId, `${dayKey()}:search`, 1, 0);
    const out = (j.items || []).filter((x) => x.id?.videoId).map((x) => ({ id: x.id.videoId, titulo: decode(x.snippet?.title), canal: decode(x.snippet?.channelTitle) })).slice(0, n);
    await cachePut(userId, key, out, cfg.cache_busqueda_dias * DAY);
    return out;
  }

  const ultima = (userId) => cacheGet(userId, "yt:ultima");
  const guardarUltima = (userId, data) => cachePut(userId, "yt:ultima", data, MAX_TTL);
  // Playlists en caché, sin red (para decidir si "pon X" habla de una lista)
  const playlistsEnCache = (userId) => cacheGet(userId, "yt:playlists");

  async function purge(userId) {
    return (await run(db, "DELETE FROM settings WHERE user_id=? AND key LIKE 'yt:%'", [userId])).changes;
  }

  return { enabled, name: PROVIDER, config: cfg, ready, playlists, items, search, usage, purge, buscarEnCache, ultima, guardarUltima, playlistsEnCache };
}
