// Línea de comando de Antigravity CLI (`agy` 1.5.x), que sustituye a Gemini CLI. VERIFICADO con agy real.
// TODOS los flags de la CLI viven AQUÍ para poder corregirlos en un solo sitio.
//
//   -p / --print <prompt>       modo no interactivo; el prompt va COMO VALOR del flag (con stdin falla)
//   --model <id>                ids de `agy models`
//   --output-format stream-json NDJSON: init / step_update / result
//   --mode plan                 SOLO LECTURA de verdad (planear y verificar)
//   --mode accept-edits         programar (edita sin preguntar)
//   --effort low|medium|high|xhigh|max
// NO se usa --dangerously-skip-permissions.
// Línea de comandos de Windows ~32k: si el prompt supera PROMPT_MAX_ARG se escribe a un archivo temporal
// (fuera del repo) y se pasa un prompt corto que manda leerlo (agy tiene view_file).
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const FLAGS_USADOS = ["--print", "--output-format", "--model", "--mode", "--effort"];

// Siguen vetados los que el contrato excluye.
export const PROHIBIDOS = [/gemini-2\.5-pro/i, /flash-lite/i];
// Ids reales de la cuenta AI Pro (`agy models`). El valor efectivo viene de config/pro.json (job.model).
export const MODELO_PLAN_DEFECTO = "gemini-3.8-flash-high";
export const CADENA_PROGRAMAR = ["gemini-3.8-flash-medium", "gemini-3.8-flash-low"];
export const PROMPT_MAX_ARG = 6000;

export const normalizeModel = (m) => String(m || "");
export const isProhibited = (m) => PROHIBIDOS.some((re) => re.test(m));

// Programar baja de modelo solo ante 503 (lo decide pro-worker); el resto, un solo modelo.
export function modelChain(role, model) {
  const m = normalizeModel(model || MODELO_PLAN_DEFECTO);
  if (role !== "programar") return [m];
  const i = CADENA_PROGRAMAR.indexOf(m);
  return i >= 0 ? CADENA_PROGRAMAR.slice(i) : [m];
}

// accept-edits solo al programar en modo editar; todo lo demás (planear, verificar, solo_lectura) en plan.
export const agyMode = (role, mode) => (role === "programar" && mode === "editar" ? "accept-edits" : "plan");
// Los ids gemini-*-low/medium/high ya llevan el esfuerzo dentro; --effort solo para el resto.
export const agyEffort = (role, model) => (/-(low|medium|high)$/.test(String(model)) ? null : role === "programar" ? "medium" : "high");

export const PREFIJO_LECTURA = "MODO SOLO LECTURA: no crees, modifiques ni borres archivos ni ejecutes comandos que cambien el repo. Responde con el contenido COMPLETO (plan, informe o verificación) directamente en el mensaje; no lo guardes en archivos ni artefactos ni lo resumas con un enlace.\n\n";

// Prepara el texto del prompt: refuerzo de solo lectura y, si es largo, archivo temporal. { text, cleanup() }.
export function prepareAgyPrompt(prompt, { role, mode } = {}, { tmp = tmpdir(), max = PROMPT_MAX_ARG } = {}) {
  const full = (agyMode(role, mode) === "plan" ? PREFIJO_LECTURA : "") + String(prompt || "");
  if (full.length <= max) return { text: full, cleanup() {} };
  const dir = mkdtempSync(join(tmp, "jarvis-agy-"));
  const file = join(dir, "instrucciones.md");
  writeFileSync(file, full, "utf8");
  return { text: `Lee y sigue exactamente las instrucciones de ${file}`, file, cleanup() { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ya no está */ } } };
}

export function buildAgyArgs({ model, role = "planear", mode = "solo_lectura", prompt, conversation = null }) {
  const m = normalizeModel(model || MODELO_PLAN_DEFECTO);
  const a = ["--print", String(prompt ?? ""), "--output-format", "stream-json", "--model", m, "--mode", agyMode(role, mode)];
  const e = agyEffort(role, m); if (e) a.push("--effort", e);
  if (conversation) a.push("--conversation", conversation);
  return a;
}

// Entorno sin claves de API: fuerza el login de la cuenta.
export function agyEnv(env = process.env) {
  const e = { ...env };
  for (const k of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_USE_VERTEXAI", "GOOGLE_GENAI_USE_GCA"]) delete e[k];
  return e;
}

// Patrones privados que se ocultan al motor (.geminiignore; agy puede ignorarlo: sin verificar).
export const IGNORE_PRIVADOS = [".env", ".env.*", "*.pem", "*.key", "*.p12", "id_rsa*", "secrets/", ".npmrc"];
