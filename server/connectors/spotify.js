// Spotify con OAuth 2.0 PKCE oficial (sin client secret). Apagado sin SPOTIFY_CLIENT_ID o CONNECTIONS_KEY.
// Nota de Spotify: controlar la reproducción exige una cuenta Premium.
import { createHash, randomBytes } from "node:crypto";

export const SPOTIFY_SCOPES = ["user-read-playback-state", "user-read-currently-playing", "user-read-recently-played", "user-top-read", "user-modify-playback-state"];
const NAME = "spotify";

export const pkce = () => {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

export function createSpotify({ env = process.env, fetch: f = globalThis.fetch, connections, crypto, now = () => Date.now() }) {
  const clientId = env.SPOTIFY_CLIENT_ID || "";
  const enabled = !!(clientId && crypto?.enabled);

  async function token(body) {
    const res = await f("https://accounts.spotify.com/api/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, ...body }) });
    if (!res.ok) throw new Error(`Spotify token HTTP ${res.status}`);
    return res.json();
  }
  async function accessToken(userId) {
    const c = await connections.load(userId, NAME);
    if (!c) throw new Error("Spotify no está conectado");
    if (c.expires_at > now() + 30_000) return c.access_token;
    const t = await token({ grant_type: "refresh_token", refresh_token: c.refresh_token });
    await connections.save(userId, NAME, { ...c, access_token: t.access_token, refresh_token: t.refresh_token || c.refresh_token, expires_at: now() + (t.expires_in || 3600) * 1000 });
    return t.access_token;
  }
  async function api(userId, path, { method = "GET" } = {}) {
    const res = await f(`https://api.spotify.com/v1${path}`, { method, headers: { authorization: `Bearer ${await accessToken(userId)}` } });
    if (res.status === 204 || res.status === 202) return {};
    if (!res.ok) throw new Error(`Spotify HTTP ${res.status}`);
    return res.json().catch(() => ({}));
  }
  const track = (t) => t && { nombre: t.name, artistas: (t.artists || []).map((a) => a.name).join(", "), album: t.album?.name || "" };

  return {
    enabled, name: NAME,
    connected: (userId) => (enabled ? connections.connected(userId, NAME) : false),
    authUrl({ state, redirectUri, challenge }) {
      const p = new URLSearchParams({ client_id: clientId, response_type: "code", redirect_uri: redirectUri, scope: SPOTIFY_SCOPES.join(" "), state, code_challenge_method: "S256", code_challenge: challenge });
      return `https://accounts.spotify.com/authorize?${p}`;
    },
    async completeAuth(userId, code, redirectUri, verifier) {
      const t = await token({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier });
      await connections.save(userId, NAME, { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: now() + (t.expires_in || 3600) * 1000, scope: t.scope });
    },
    disconnect: (userId) => connections.remove(userId, NAME),
    async nowPlaying(userId) {
      const j = await api(userId, "/me/player/currently-playing");
      return j?.item ? { sonando: !!j.is_playing, ...track(j.item) } : { sonando: false };
    },
    async recent(userId, limit = 10) {
      const j = await api(userId, `/me/player/recently-played?limit=${Math.min(Number(limit) || 10, 30)}`);
      return (j.items || []).map((i) => track(i.track));
    },
    async top(userId, limit = 10) {
      const j = await api(userId, `/me/top/tracks?limit=${Math.min(Number(limit) || 10, 30)}&time_range=short_term`);
      return (j.items || []).map(track);
    },
    async control(userId, accion) {
      const map = { play: ["PUT", "/me/player/play"], pausa: ["PUT", "/me/player/pause"], siguiente: ["POST", "/me/player/next"], anterior: ["POST", "/me/player/previous"] };
      const m = map[accion];
      if (!m) throw new Error("acción desconocida");
      await api(userId, m[1], { method: m[0] });
      return { ok: true, accion };
    },
  };
}
