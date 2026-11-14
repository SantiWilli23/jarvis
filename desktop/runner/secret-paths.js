// Rutas que Claude NO debe leer ni escribir en la cola normal (ni en el Modo Pro): secretos y los "guardianes"
// (el código y la configuración que deciden qué se permite). Patrones al estilo de las reglas de Claude Code.
export const SECRETOS = ["**/.env", "**/.env.*", "**/*.pem", "**/*.key", "**/*.p12"];
export const GUARDIANES = [
  "**/desktop/runner/danger.js", "**/desktop/runner/agy-policy.js", "**/desktop/runner/agy-args.js",
  "**/desktop/runner/claude-args.js", "**/desktop/runner/secret-paths.js", "**/config/permissions.json",
];

const REGLAS_ESCRITURA = ["Edit", "Write", "MultiEdit"];
// Reglas --disallowedTools: secretos sin lectura ni escritura; guardianes sin lectura de .env y sin escritura.
export const DENEGADAS_CLAUDE = [
  ...SECRETOS.flatMap((p) => ["Read", ...REGLAS_ESCRITURA].map((t) => `${t}(${p})`)),
  ...GUARDIANES.flatMap((p) => REGLAS_ESCRITURA.map((t) => `${t}(${p})`)),
];

// Para la vigilancia de Gemini (agy): ¿esta ruta es secreta o guardián? (solo por nombre, sin importar la carpeta)
const norm = (p) => String(p).replace(/\\/g, "/").toLowerCase();
export function rutaProtegida(p) {
  const r = norm(p), base = r.split("/").pop();
  if (base === ".env" || base.startsWith(".env.") || /\.(pem|key|p12)$/.test(base)) return "secreto";
  if (GUARDIANES.some((g) => r.endsWith(g.slice(2)))) return "guardian";
  return null;
}
