// Clima de hoy con Open-Meteo (gratis, sin clave). Solo sale el nombre de la comuna o sus coordenadas.
import { get, run } from "../db/client.js";
import { limpiar } from "./comun.js";

const KEY = "comuna";
const COMUNA = /^(?:mi comuna es|(?:yo )?vivo en la comuna de|(?:cambia|guarda) mi comuna (?:a|como)) ([a-zñ' ]{2,40})$/;
const NO_ES = /^(?:muy|mas|un|una|bien|tan|super|bastante|fea|bonita|linda|chica|grande|tranquila|peligrosa|aburrida)\b/;

export function parseComuna(text) {
  const { orig, p } = limpiar(text);
  const m = COMUNA.exec(p);
  if (!m || NO_ES.test(m[1]) || m[1].split(" ").length > 4) return null;
  return orig.slice(orig.length - m[1].length).replace(/(^|\s)(\p{L})/gu, (_x, a, b) => a + b.toUpperCase());
}

// Códigos WMO resumidos.
const cielo = (c) => (c === 0 ? "despejado" : c <= 2 ? "parcialmente nublado" : c === 3 ? "nublado" : c <= 48 ? "con niebla" : c <= 57 ? "con llovizna" : c <= 67 ? "con lluvia" : c <= 77 ? "con nieve" : c <= 82 ? "con chubascos" : c <= 86 ? "con nieve" : "con tormenta");

export function createClima({ db, fetch: f = globalThis.fetch, zona, now }) {
  const json = async (url) => {
    const r = await f(url, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };
  async function buscar(nombre) {
    const d = await json(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: nombre, count: "5", language: "es", format: "json", countryCode: "CL" })}`);
    const x = d.results?.[0];
    return x ? { nombre, lat: x.latitude, lon: x.longitude } : null;
  }
  const guardar = (userId, v) => run(db, "INSERT INTO settings (user_id, key, value, created_at) VALUES (?,?,?,?) ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value", [userId, KEY, JSON.stringify(v), now()]);
  const leer = async (userId) => {
    try { return JSON.parse((await get(db, "SELECT value FROM settings WHERE user_id=? AND key=?", [userId, KEY]))?.value ?? "null"); } catch { return null; }
  };

  return {
    leer,
    async fijar(userId, nombre) {
      let sitio;
      try { sitio = await buscar(nombre); }
      catch { await guardar(userId, { nombre }); return `Guardé su comuna, señor: ${nombre}. El servicio del clima no respondió; lo reviso la próxima vez.`; }
      if (!sitio) return `No encuentro «${nombre}» en Chile, señor. Dígame otra vez «mi comuna es …».`;
      await guardar(userId, sitio);
      return `Guardado, señor: su comuna es ${nombre}.`;
    },
    // Frase corta, o aviso en una frase. Nunca lanza.
    async hoy(userId) {
      let s = await leer(userId);
      if (!s) return "Para el clima, dígame «mi comuna es …».";
      try {
        if (s.lat == null) {
          s = await buscar(s.nombre);
          if (!s) return "No encuentro su comuna: dígame otra vez «mi comuna es …».";
          await guardar(userId, s);
        }
        const d = await json(`https://api.open-meteo.com/v1/forecast?${new URLSearchParams({ latitude: s.lat, longitude: s.lon, current: "temperature_2m", daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max", timezone: zona, forecast_days: "1" })}`);
        const dia = d.daily, lluvia = dia.precipitation_probability_max?.[0], ahora = d.current?.temperature_2m;
        return `En ${s.nombre}, ${cielo(dia.weather_code[0])}${ahora != null ? `, ahora ${Math.round(ahora)}°` : ""}, mínima ${Math.round(dia.temperature_2m_min[0])}° y máxima ${Math.round(dia.temperature_2m_max[0])}°${lluvia >= 20 ? `, ${lluvia}% de lluvia` : ""}.`;
      } catch (e) {
        console.error("[clima]", e?.message);
        return "No pude consultar el clima.";
      }
    },
  };
}
