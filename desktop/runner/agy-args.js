// Línea de comando de Antigravity CLI (`agy`), que sustituye a Gemini CLI (ya no atiende cuentas Google AI Pro).
// TODOS los flags de la CLI viven AQUÍ para poder corregirlos en un solo sitio.
//
// SIN VERIFICAR: `agy` no estaba instalada al escribir esto. Flags según el contrato del coordinador:
//   -p                       modo no interactivo
//   --output-format stream-json
//   --model <id>
//   --conversation <id>      continuar una conversación (reservado; no se usa aún)
// NO se usa --dangerously-skip-permissions. Se desconoce si existe un flag de modo de aprobación: no se pasa.
// Por eso "solo lectura" se pide en el propio prompt (PREFIJO_LECTURA) y el diff real lo comprueba.
// `doctor.js` comprueba FLAGS_USADOS contra `agy --help`.
//
// Login: la cuenta AI Pro (login de la CLI). El runner quita las claves de API del entorno.
// Prompt por stdin (SIN VERIFICAR que `agy -p` lo lea de stdin; si no, ajustar aquí buildAgyStdin).

export const FLAGS_USADOS = ["-p", "--output-format", "--model"];

// Ya no se prohíbe gemini-4-*; siguen vetados los que el contrato excluye.
export const PROHIBIDOS = [/gemini-2\.5-pro/i, /flash-lite/i];
// Modelo por defecto de plan/verificación (el "Argon" del plan AI Pro). El valor real viene de config/pro.json
// (job.model). El id exacto se confirma con `agy --help` / la lista de modelos de la CLI.
export const MODELO_PLAN_DEFECTO = "argon";
export const CADENA_PROGRAMAR = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"];

// "3.7-flash" -> "gemini-3.7-flash"; ids como "argon" quedan igual.
export const normalizeModel = (m) => (/^\d/.test(String(m)) ? `gemini-${m}` : String(m));
export const isProhibited = (m) => PROHIBIDOS.some((re) => re.test(m));

// Programar baja de Flash solo ante 503 (lo decide pro-worker); el resto, un solo modelo.
export function modelChain(role, model) {
  const m = normalizeModel(model || MODELO_PLAN_DEFECTO);
  if (role !== "programar") return [m];
  const i = CADENA_PROGRAMAR.indexOf(m);
  return i >= 0 ? CADENA_PROGRAMAR.slice(i) : [m];
}

export function buildAgyArgs({ model, conversation = null }) {
  const a = ["-p", "--output-format", "stream-json", "--model", normalizeModel(model || MODELO_PLAN_DEFECTO)];
  if (conversation) a.push("--conversation", conversation);
  return a;
}

export const PREFIJO_LECTURA = "MODO SOLO LECTURA: no crees, modifiques ni borres archivos ni ejecutes comandos que cambien el repo.\n\n";
export const buildAgyStdin = (prompt, mode) => Buffer.from((mode === "editar" ? "" : PREFIJO_LECTURA) + prompt, "utf8");

// Entorno sin claves de API: fuerza el login de la cuenta.
export function agyEnv(env = process.env) {
  const e = { ...env };
  for (const k of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_USE_VERTEXAI", "GOOGLE_GENAI_USE_GCA"]) delete e[k];
  return e;
}

// Patrones privados que se ocultan al motor (se escriben en .geminiignore; agy puede ignorarlo: sin verificar).
export const IGNORE_PRIVADOS = [".env", ".env.*", "*.pem", "*.key", "*.p12", "id_rsa*", "secrets/", ".npmrc"];
