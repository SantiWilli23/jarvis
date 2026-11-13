// Línea de comando de Antigravity CLI (`agy`), que sustituye a Gemini CLI. TODOS los flags viven AQUÍ.
// Verificado contra agy 1.5.8 (`agy --help`, `agy models` y llamadas reales con -p):
//   -p <pedido>            modo no interactivo; el pedido va como argumento (stdin se cierra)
//   --output-format stream-json   NDJSON: init, step_update..., result
//   --sandbox              pedido de terminal restringida. OJO: en Windows NO confina escrituras ni comandos fuera
//                          de la carpeta de trabajo (se comprobó), por eso el runner vigila las herramientas.
//   --print-timeout 30m    tope de tiempo del modo -p
//   --model <id>           gemini-3.8-flash-high (id de `agy models`)
//   --conversation <id>    continuar una conversación
// NUNCA se pasa --dangerously-skip-permissions ni --mode auto.

export const FLAGS_USADOS = ["-p", "--output-format", "--sandbox", "--print-timeout", "--model"];

export const MODELO_DEFECTO = "gemini-3.8-flash-high";
export const MODELO_PLAN_DEFECTO = MODELO_DEFECTO; // planear/verificar dentro de agy (Hydrogen planea por la API, no por agy)
export const CADENA_PROGRAMAR = ["gemini-3.8-flash-high", "gemini-3.8-flash-medium", "gemini-3.8-flash-low"];
export const VERSION_MINIMA = "1.1.1";

// Lista cerrada: solo Hydrogen (nivel gratis) y la familia 3.8 Flash. Argon, Carbon, 3.1-pro, 2.5-pro, flash-lite: no.
const PERMITIDOS = [/^gemini-4-hydrogen$/i, /^gemini-3\.8-flash(-(high|medium|low))?$/i];
export const PROHIBIDOS = [/gemini-2\.5-pro/i, /flash-lite/i, /gemini-4-(argon|carbon)/i, /gemini-3\.1-pro/i];

// "3.8-flash" -> "gemini-3.8-flash"; ids completos quedan igual.
export const normalizeModel = (m) => (/^\d/.test(String(m)) ? `gemini-${m}` : String(m));
export const isProhibited = (m) => PROHIBIDOS.some((re) => re.test(m)) || !PERMITIDOS.some((re) => re.test(m));

// Programar baja de modelo solo ante 503 (lo decide pro-worker); el resto, un solo modelo.
export function modelChain(role, model) {
  const m = normalizeModel(model || MODELO_PLAN_DEFECTO);
  if (role !== "programar") return [m];
  const i = CADENA_PROGRAMAR.indexOf(m);
  return i >= 0 ? CADENA_PROGRAMAR.slice(i) : [m];
}

// El pedido viaja en la línea de comandos: tope práctico de Windows ~32 000 caracteres.
export const MAX_PEDIDO = 28_000;

export function buildAgyArgs({ prompt, model, conversation = null, timeout = "30m" }) {
  const a = ["-p", String(prompt), "--output-format", "stream-json", "--sandbox", "--print-timeout", timeout, "--model", normalizeModel(model || MODELO_DEFECTO)];
  if (conversation) a.push("--conversation", conversation);
  return a;
}

// "1.5.8" >= "1.1.1"
export function versionOk(v, min = VERSION_MINIMA) {
  const n = (s) => String(s).match(/\d+/g)?.slice(0, 3).map(Number) ?? [];
  const a = n(v), b = n(min);
  if (!a.length) return false;
  for (let i = 0; i < 3; i++) { const x = a[i] ?? 0, y = b[i] ?? 0; if (x !== y) return x > y; }
  return true;
}

export const PREFIJO_LECTURA = "MODO SOLO LECTURA: no crees, modifiques ni borres archivos ni ejecutes comandos que cambien el repo.\n\n";
export const PREFIJO_PROGRAMAR = "LÍMITES: trabaja SOLO dentro de la carpeta actual; no uses navegador ni internet; no ejecutes comandos salvo git status/diff/log/show; no leas ni escribas fuera de esta carpeta.\n\n";
// Primera capa (consejo al modelo; NO es una garantía: la garantía es el guardián de eventos de agy-policy.js).
export const buildAgyPrompt = (prompt, mode) => (mode === "editar" ? PREFIJO_PROGRAMAR : PREFIJO_LECTURA) + prompt;

// Entorno sin claves de API: fuerza el login de la cuenta del PC.
export function agyEnv(env = process.env) {
  const e = { ...env };
  for (const k of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_USE_VERTEXAI", "GOOGLE_GENAI_USE_GCA"]) delete e[k];
  return e;
}

// Patrones privados que se ocultan al motor (se escriben en .geminiignore; agy puede ignorarlo: sin verificar).
export const IGNORE_PRIVADOS = [".env", ".env.*", "*.pem", "*.key", "*.p12", "id_rsa*", "secrets/", ".npmrc"];
