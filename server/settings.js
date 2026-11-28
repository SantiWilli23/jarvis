// Ajustes por usuario (tabla `settings`). Hoy solo `modo`: "ia" (por defecto) o "chat" (solo conversar).
import { get, run } from "./db/client.js";
import { entradaValida, MAX_LISTA } from "../desktop/runner/pc-reglas.js";

export const MODOS = ["ia", "chat"];
export const KEY_MODO = "modo";

export async function getModo(db, userId) {
  const r = await get(db, "SELECT value FROM settings WHERE user_id=? AND key=?", [userId, KEY_MODO]);
  return MODOS.includes(r?.value) ? r.value : "ia";
}

// Capturas en vivo del navegador de Claude (apagadas por defecto).
export async function getNavCapturas(db, userId) {
  const r = await get(db, "SELECT value FROM settings WHERE user_id=? AND key='nav_capturas'", [userId]);
  return r?.value === "1";
}

export async function setNavCapturas(db, userId, on, now = Date.now()) {
  await run(db, "INSERT INTO settings (user_id, key, value, created_at) VALUES (?,'nav_capturas',?,?) ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value", [userId, on ? "1" : "0", now]);
}

// Selector de modelo del navegador: null = lo que diga config/nav.json.
export async function getNavElegirModelo(db, userId) {
  const r = await get(db, "SELECT value FROM settings WHERE user_id=? AND key='nav_elegir_modelo'", [userId]);
  return r?.value === "1" ? true : r?.value === "0" ? false : null;
}

export async function setNavElegirModelo(db, userId, on, now = Date.now()) {
  await run(db, "INSERT INTO settings (user_id, key, value, created_at) VALUES (?,'nav_elegir_modelo',?,?) ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value", [userId, on ? "1" : "0", now]);
}

// Lista autorizada de ratón y teclado: [{ tipo: "app"|"host", valor }].
export async function getRatonLista(db, userId, opts) {
  const r = await get(db, "SELECT value FROM settings WHERE user_id=? AND key='raton_lista'", [userId]);
  let l = [];
  try { l = JSON.parse(r?.value || "[]"); } catch { /* vacía */ }
  return (Array.isArray(l) ? l : []).map((e) => entradaValida(e, opts)).filter(Boolean).slice(0, MAX_LISTA);
}

export async function setRatonLista(db, userId, lista, now = Date.now()) {
  await run(db, "INSERT INTO settings (user_id, key, value, created_at) VALUES (?,'raton_lista',?,?) ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value", [userId, JSON.stringify(lista), now]);
}

export async function setModo(db, userId, modo, now = Date.now()) {
  if (!MODOS.includes(modo)) throw new Error("modo_invalido");
  await run(db, "INSERT INTO settings (user_id, key, value, created_at) VALUES (?,?,?,?) ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value", [userId, KEY_MODO, modo, now]);
  return modo;
}
