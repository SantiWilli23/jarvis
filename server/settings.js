// Ajustes por usuario (tabla `settings`). Hoy solo `modo`: "ia" (por defecto) o "chat" (solo conversar).
import { get, run } from "./db/client.js";

export const MODOS = ["ia", "chat"];
export const KEY_MODO = "modo";

export async function getModo(db, userId) {
  const r = await get(db, "SELECT value FROM settings WHERE user_id=? AND key=?", [userId, KEY_MODO]);
  return MODOS.includes(r?.value) ? r.value : "ia";
}

export async function setModo(db, userId, modo, now = Date.now()) {
  if (!MODOS.includes(modo)) throw new Error("modo_invalido");
  await run(db, "INSERT INTO settings (user_id, key, value, created_at) VALUES (?,?,?,?) ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value", [userId, KEY_MODO, modo, now]);
  return modo;
}
