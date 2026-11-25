// Rutas que Claude NO debe leer ni escribir en la cola normal (ni en el Modo Pro): secretos y los "guardianes"
// (el código y la configuración que deciden qué se permite). Patrones al estilo de las reglas de Claude Code.
export const SECRETOS = [
  "**/.env", "**/.env.*", "**/*.pem", "**/*.key", "**/*.p12", "**/*.pfx", "**/*.kdbx", "**/*.keystore", "**/*.jks",
  "**/id_rsa*", "**/id_ed25519*", "**/id_ecdsa*", "**/.ssh/**", "**/.aws/**", "**/.gnupg/**", "**/.npmrc", "**/.netrc",
  "**/wallet.dat", "**/*.wallet", "**/Cookies", "**/Login Data", "**/cookies.sqlite", "**/logins.json",
];
export const GUARDIANES = [
  "**/desktop/runner/danger.js", "**/desktop/runner/agy-policy.js", "**/desktop/runner/agy-args.js",
  "**/desktop/runner/claude-args.js", "**/desktop/runner/secret-paths.js", "**/config/permissions.json",
  "**/desktop/runner/pc-spec.js", "**/desktop/runner/pc-exec.js", "**/desktop/runner/pc-files.js", "**/desktop/runner/pc-capture.js",
];

const REGLAS_ESCRITURA = ["Edit", "Write", "MultiEdit"];
// Reglas --disallowedTools: secretos sin lectura ni escritura; guardianes sin lectura de .env y sin escritura.
export const DENEGADAS_CLAUDE = [
  ...SECRETOS.flatMap((p) => ["Read", ...REGLAS_ESCRITURA].map((t) => `${t}(${p})`)),
  ...GUARDIANES.flatMap((p) => REGLAS_ESCRITURA.map((t) => `${t}(${p})`)),
];

// ¿Esta ruta es secreta o guardián? (solo por nombre, sin importar la carpeta)
const norm = (p) => String(p).replace(/\\/g, "/").toLowerCase();
export function rutaProtegida(p) {
  const r = norm(p), base = r.split("/").pop();
  if (base === ".env" || base.startsWith(".env.") || /\.(pem|key|p12|pfx|kdbx|keystore|jks|wallet)$/.test(base)) return "secreto";
  if (GUARDIANES.some((g) => r.endsWith(g.slice(2)))) return "guardian";
  if (/^(id_rsa|id_ed25519|id_ecdsa)/.test(base) || ["wallet.dat", ".npmrc", ".netrc", "cookies", "login data", "cookies.sqlite", "logins.json"].includes(base)) return "secreto";
  if (/(^|\/)\.(ssh|aws|gnupg)\//.test(r)) return "secreto";
  return null;
}
