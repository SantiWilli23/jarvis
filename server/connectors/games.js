// Conector del juego de fútbol: SOLO LECTURA (únicamente peticiones GET). Apagado sin GAMES_API_URL.
// Qué expone el servidor del juego (revisado en solo lectura): /api/health y /api/public/features son
// públicos; el resto (/api/stats/global-ranking, /api/me/progreso...) pide un JWT de 30 días
// ("Authorization: Bearer"), que se obtiene con POST /api/auth/login del propio juego.
// Por eso GAMES_API_TOKEN es opcional: sin él solo funcionan estado y funciones activas.
// El juego no ofrece una clave de servicio ni un endpoint de "mis puntos": si se quiere algo más
// estable, habría que añadirle allí un token de solo lectura (ver docs/GUIA-USUARIO.md).
export function createGames({ env = process.env, fetch: f = globalThis.fetch }) {
  const raw = String(env.GAMES_API_URL || "").trim().replace(/\/+$/, "");
  const valid = /^https?:\/\/[^\s]+$/.test(raw);
  const token = env.GAMES_API_TOKEN || "";
  async function get(path) {
    const res = await f(`${raw}${path}`, { method: "GET", headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Juego HTTP ${res.status}`);
    return res.json();
  }
  return {
    enabled: valid, hasToken: !!token,
    health: () => get("/api/health"),
    features: () => get("/api/public/features"),
    async ranking({ period = "all", top = 5 } = {}) {
      const p = ["week", "month"].includes(period) ? period : "all";
      const j = await get(`/api/stats/global-ranking?period=${p}`);
      return { ranking: (j.ranking || []).slice(0, Math.min(Number(top) || 5, 20)), myPosition: j.myPosition ?? null };
    },
    progreso: () => get("/api/me/progreso"),
  };
}
