// Política de herramientas de Gemini (agy) por rol. SEGUNDA capa: agy en Windows no confina por sí mismo
// (`--sandbox` no impidió escribir/ejecutar fuera de la carpeta) y su configuración global (settings.json)
// no se toca desde aquí; por eso el runner revisa CADA evento de herramienta y, si algo no está permitido,
// mata el proceso y la tarea queda fallida/rechazada. LÍMITE (ver docs/GUIA-USUARIO.md): la vigilancia reacciona
// al evento; no es un confinamiento del sistema operativo y no ve lo que hace un comando ya permitido por dentro.
import { resolve, join } from "node:path";
import { blockedForGemini } from "./danger.js";
import { rutaProtegida } from "./secret-paths.js";

export const POLITICAS = { LECTURA: "lectura", PROGRAMAR: "programar" };

// planear/verificar o modo solo lectura => "lectura"; el resto (programar/corregir/editar) => "programar".
export function policyFor({ role = null, mode = null } = {}) {
  if (mode === "solo_lectura" || role === "planear" || role === "verificar") return POLITICAS.LECTURA;
  return POLITICAS.PROGRAMAR;
}

// Lista corta de comandos permitidos al programar: un solo comando simple, sin encadenar ni redirigir.
export const COMANDOS_PERMITIDOS = [/^git\s+(status|diff|log|show)(\s+[\w./=:@^~-]+)*$/i, /^(ls|dir)(\s+[\w./\\-]+)*$/i, /^(node|npm)\s+(-v|--version)$/i];
const META = /[;&|<>`$\n\r]|\$\(/;
export const commandAllowed = (cmd) => { const c = String(cmd).trim(); return !!c && !META.test(c) && COMANDOS_PERMITIDOS.some((re) => re.test(c)); };

const RE_WEB = /browser|navigate|url|web|screenshot|click|http|fetch|download/i;
const RE_CMD = /command|shell|terminal|exec|bash|powershell|cmd/i;
const RE_ESCRIBE = /write|edit|replace|delete|remove|create|move|rename|patch|insert|append|mkdir|save/i;
const RE_MCP = /^mcp|mcp_/i;

const norm = (p) => resolve(String(p)).replace(/[\\]/g, "/").toLowerCase();
export const inside = (p, dirs) => dirs.some((d) => { const a = norm(p), b = norm(d); return a === b || a.startsWith(b.endsWith("/") ? b : b + "/"); });
const cmdOf = (params) => { const v = params?.CommandLine ?? params?.command ?? params?.Command; return typeof v === "string" ? v : null; };
export function pathsOf(params) {
  const out = [];
  for (const [k, v] of Object.entries(params || {})) if (typeof v === "string" && /path|file|dir|target|cwd/i.test(k)) out.push(v);
  return out;
}

// Devuelve null si se permite, o { kind, summary, detail } si se debe matar.
export function guardTool({ tool, params }, allowedDirs = [], cwd = process.cwd(), policy = POLITICAS.PROGRAMAR) {
  const name = String(tool || "");
  const cmd = cmdOf(params);
  const deny = (kind, summary, detail) => ({ kind, summary, detail: detail ?? `${name}` });
  if (RE_MCP.test(name)) return deny("herramienta_no_permitida", "Herramienta MCP no permitida a Gemini", name);
  if (RE_WEB.test(name) && !cmd) return deny("herramienta_no_permitida", "Navegador o red no permitidos a Gemini", name);
  if (cmd || RE_CMD.test(name)) {
    if (policy === POLITICAS.LECTURA) return deny("comando_no_permitido", "Este rol de Gemini es solo lectura: no ejecuta comandos", cmd ?? name);
    if (cmd) {
      const b = blockedForGemini(cmd);
      if (b) return { ...b, detail: cmd };
      if (!commandAllowed(cmd)) return deny("comando_no_permitido", "Comando fuera de la lista corta permitida a Gemini", cmd);
    } else return deny("comando_no_permitido", "Ejecución sin comando legible", name);
  }
  if (policy === POLITICAS.LECTURA && RE_ESCRIBE.test(name)) return deny("escritura_no_permitida", "Este rol de Gemini es solo lectura: no escribe archivos", name);
  if (!allowedDirs.length) return deny("fuera_de_carpeta", "Sin carpeta permitida para Gemini", name);
  for (const p of pathsOf(params)) {
    const raw = String(p);
    const abs = /^([a-z]:[\\/]|[\\/]{1,2})/i.test(raw) ? raw : /^[~%$]/.test(raw) ? "/__fuera__" : join(cwd, raw);
    const prot = rutaProtegida(abs);
    if (prot) return deny("fuera_de_carpeta", prot === "secreto" ? "Gemini no puede tocar secretos (.env, claves, certificados)" : "Gemini no puede tocar los archivos guardianes de Jarvis", `${name}: ${raw}`);
    if (!inside(abs, allowedDirs)) return deny("fuera_de_carpeta", "Tocar archivos fuera de las carpetas de Gemini", `${name}: ${raw}`);
  }
  return null;
}
