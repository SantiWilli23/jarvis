// Cuotas por proveedor: contadores por minuto y por día en la BD, lectura de cabeceras
// de límite y pausa cuando un proveedor responde 429.
import { all, get, run } from "../db/client.js";

const DEFAULT_PAUSE_MS = 60_000;

// "2m59.56s", "1h2m", "450ms", "7.66s" -> milisegundos
export function parseDuration(s) {
  if (s == null || s === "") return null;
  if (/^\d+(\.\d+)?$/.test(String(s))) return Number(s) * 1000;
  let ms = 0, found = false;
  for (const m of String(s).matchAll(/([\d.]+)(ms|h|m|s)/g)) {
    found = true;
    const v = Number(m[1]);
    ms += m[2] === "ms" ? v : m[2] === "s" ? v * 1000 : m[2] === "m" ? v * 60_000 : v * 3_600_000;
  }
  return found ? ms : null;
}

// Instante (ms epoch) en que el proveedor vuelve a estar disponible, según sus cabeceras. null si no dicen nada.
export function resetFromHeaders(h = {}, now) {
  const ra = h["retry-after"];
  if (ra != null) {
    if (/^\d+(\.\d+)?$/.test(String(ra))) return now + Number(ra) * 1000;
    const d = Date.parse(ra);
    if (!Number.isNaN(d)) return d;
  }
  for (const k of ["x-ratelimit-reset", "x-ratelimit-reset-requests", "x-ratelimit-reset-tokens"]) {
    const v = h[k];
    if (v == null) continue;
    if (/^\d+(\.\d+)?$/.test(String(v))) {
      const n = Number(v);
      return n > 1e12 ? n : n > 1e9 ? n * 1000 : now + n * 1000; // epoch ms / epoch s / segundos relativos
    }
    const d = parseDuration(v);
    if (d != null) return now + d;
  }
  return null;
}

const dayKey = (t) => "d:" + new Date(t).toISOString().slice(0, 10);
const minKey = (t) => "m:" + Math.floor(t / 60_000);

// limits: { groq: { rpm: 30, rpd: 1000 }, ... } (null = sin tope conocido)
export function createQuota({ db, limits = {}, now = () => Date.now() }) {
  async function count(userId, provider, key) {
    const r = await get(db, "SELECT count FROM provider_usage WHERE user_id=? AND provider=? AND window_key=?", [userId, provider, key]);
    return r ? Number(r.count) : 0;
  }
  async function pausedUntil(userId, provider) {
    const r = await get(db, "SELECT paused_until FROM provider_state WHERE user_id=? AND provider=?", [userId, provider]);
    return r?.paused_until ? Number(r.paused_until) : 0;
  }
  async function setState(userId, provider, patch) {
    const t = now();
    const cur = await get(db, "SELECT * FROM provider_state WHERE user_id=? AND provider=?", [userId, provider]);
    if (!cur) {
      await run(db, "INSERT INTO provider_state (user_id, provider, paused_until, last_error, headers_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
        [userId, provider, patch.paused_until ?? null, patch.last_error ?? null, patch.headers_json ?? null, t, t]);
    } else {
      const m = { ...cur, ...patch };
      await run(db, "UPDATE provider_state SET paused_until=?, last_error=?, headers_json=?, updated_at=? WHERE user_id=? AND provider=?",
        [m.paused_until ?? null, m.last_error ?? null, m.headers_json ?? null, t, userId, provider]);
    }
  }
  return {
    // ¿Se puede llamar ahora a este proveedor? { ok, reason, until }
    async check(userId, provider) {
      const t = now();
      const pu = await pausedUntil(userId, provider);
      if (pu > t) return { ok: false, reason: "pausado", until: pu };
      const lim = limits[provider] || {};
      if (lim.rpm != null && (await count(userId, provider, minKey(t))) >= lim.rpm) {
        return { ok: false, reason: "minuto", until: (Math.floor(t / 60_000) + 1) * 60_000 };
      }
      if (lim.rpd != null && (await count(userId, provider, dayKey(t))) >= lim.rpd) {
        const d = new Date(t); d.setUTCHours(24, 0, 0, 0);
        return { ok: false, reason: "dia", until: d.getTime() };
      }
      return { ok: true };
    },
    async record(userId, provider, tokens = 0) {
      const t = now();
      for (const key of [minKey(t), dayKey(t)]) {
        await run(db, `INSERT INTO provider_usage (user_id, provider, window_key, count, tokens, created_at) VALUES (?,?,?,1,?,?)
          ON CONFLICT(user_id, provider, window_key) DO UPDATE SET count = count + 1, tokens = tokens + excluded.tokens`,
          [userId, provider, key, tokens, t]);
      }
    },
    // Lee cabeceras de límite tras una respuesta correcta; si ya no quedan peticiones, pausa hasta el reinicio.
    async ingestHeaders(userId, provider, headers = {}) {
      if (!headers || !Object.keys(headers).length) return;
      const rem = headers["x-ratelimit-remaining-requests"] ?? headers["x-ratelimit-remaining"];
      const patch = { headers_json: JSON.stringify(headers) };
      if (rem != null && Number(rem) <= 0) {
        patch.paused_until = resetFromHeaders(headers, now()) ?? now() + DEFAULT_PAUSE_MS;
      }
      await setState(userId, provider, patch);
    },
    // Tras un 429 (u otro fallo): pausa hasta la hora que indiquen las cabeceras (o un minuto por defecto).
    async pauseOnError(userId, provider, { status, headers = {}, message = "" } = {}) {
      const t = now();
      let until;
      if (status === 429) until = resetFromHeaders(headers, t) ?? t + DEFAULT_PAUSE_MS;
      else if (status === 401 || status === 403) until = t + 3_600_000; // clave mala: no insistir cada vez
      else until = t + 30_000;
      await setState(userId, provider, { paused_until: until, last_error: `${status} ${message}`.slice(0, 200), headers_json: JSON.stringify(headers) });
      return until;
    },
    async pause(userId, provider, until, reason = "") {
      await setState(userId, provider, { paused_until: until, last_error: reason });
    },
    // Para el panel: uso actual de cada proveedor.
    async snapshot(userId, ids) {
      const t = now(), out = {};
      for (const id of ids) {
        const lim = limits[id] || {};
        out[id] = {
          used_min: await count(userId, id, minKey(t)),
          used_day: await count(userId, id, dayKey(t)),
          limit_min: lim.rpm ?? null,
          limit_day: lim.rpd ?? null,
          paused_until: (await pausedUntil(userId, id)) || null,
        };
      }
      return out;
    },
  };
}

export { all };
