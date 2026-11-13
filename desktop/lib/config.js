// Configuración de la app de escritorio: un JSON en la carpeta de datos del usuario (no se sube a git).
// El token de agente se guarda cifrado con safeStorage de Windows (DPAPI) cuando está disponible.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const DEFAULTS = {
  hubUrl: "http://localhost:3055",   // o la dirección de Render cuando exista (Fase 3)
  hotkey: "Control+Alt+J",           // abre/enfoca Jarvis y activa el micrófono
  autoStart: true,                   // arrancar con Windows
  alwaysOnTop: false,
  greeting: true,                    // decir "Hola señor." al arrancar
  claudePath: null,                  // ruta a claude.exe si no está en el PATH
  workFolder: null,                  // carpeta de trabajo si config/permissions.json no define ninguna
  agentToken: null,                  // lo escribe la propia app al enrolarse
  agentTokenEnc: null,
};

export function loadConfig(dir, env = process.env) {
  let file = {};
  try { file = JSON.parse(readFileSync(join(dir, "config.json"), "utf8")); } catch { /* primera vez */ }
  const c = { ...DEFAULTS, ...file };
  if (env.JARVIS_HUB_URL) c.hubUrl = env.JARVIS_HUB_URL;
  if (env.JARVIS_HOTKEY) c.hotkey = env.JARVIS_HOTKEY;
  c.hubUrl = String(c.hubUrl).replace(/\/+$/, "");
  return c;
}

export function saveConfig(dir, cfg) {
  mkdirSync(dir, { recursive: true });
  const { agentToken, ...rest } = cfg; // nunca en claro si hay cifrado
  writeFileSync(join(dir, "config.json"), JSON.stringify(agentToken && !cfg.agentTokenEnc ? { ...rest, agentToken } : rest, null, 2));
}

export const configPath = (dir) => join(dir, "config.json");
