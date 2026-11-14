// Arma la línea de comando de `claude` para una tarea. Sin --bare y SIN --dangerously-skip-permissions.
//
// Flags (de la ayuda de Claude Code; ver docs/GUIA-USUARIO.md para cómo reverificarlos con `claude --help`):
//   -p / --print                    modo no interactivo; el pedido entra por stdin (sin argumento posicional)
//   --output-format stream-json     un JSON por línea; en modo -p exige --verbose
//   --permission-mode acceptEdits   acepta ediciones SOLO dentro de la carpeta de trabajo y las de --add-dir
//   --allowedTools / --disallowedTools   lista de herramientas permitidas/bloqueadas
//   --add-dir                       carpetas extra permitidas
//   --append-system-prompt          texto extra de sistema (aquí va la hora del dictado: el pedido no se toca)
//   --max-turns                     tope de vueltas del agente
//   --resume <session_id>           continuar la misma sesión tras una aprobación

import { SECRETOS, DENEGADAS_CLAUDE } from "./secret-paths.js";

export const SOLO_LEER = ["Read", "Glob", "Grep"];
export const LEER_ESCRIBIR = [...SOLO_LEER, "Edit", "Write", "MultiEdit"];

export function buildArgs({ task, folders = [], approved = [], resume = null, maxTurns = 30, model = null }) {
  const args = ["-p", "--output-format", "stream-json", "--verbose"];
  if (resume) args.push("--resume", resume);
  const canWrite = folders.length > 0;
  args.push("--permission-mode", canWrite ? "acceptEdits" : "default");
  // Lo automático: leer (y escribir si hay carpetas permitidas). Todo lo demás (borrar, terminal libre,
  // enviar, git push, desplegar) queda denegado en -p y vuelve en permission_denials para pedir aprobación.
  const allowed = [...(canWrite ? LEER_ESCRIBIR : SOLO_LEER), ...approved];
  args.push("--allowedTools", allowed.join(","));
  for (const f of folders.slice(1)) args.push("--add-dir", f);
  args.push("--disallowedTools", DENEGADAS_CLAUDE.join(",")); // secretos y guardianes: nunca (ver secret-paths.js)
  args.push("--max-turns", String(maxTurns));
  if (model) args.push("--model", model);
  if (task?.header?.dictated_at && !resume) {
    args.push("--append-system-prompt", `Contexto: el señor dictó este pedido el ${task.header.dictated_at}. Respóndele en español.`);
  }
  return args;
}

// --- Modo Pro (docs/PRO.md §2): planear = opus solo lectura; programar = sonnet con acceptEdits;
// verificar = opus solo lectura. Nunca se pueden leer .env, claves ni certificados. `npm test`/Bash no
// van en la lista permitida: salen como "denegados" y piden aprobación (worker de Pro).
export const PRO_MODELOS = { planear: "opus", programar: "sonnet", verificar: "opus" };
export const PRIVADOS_CLAUDE = [...SECRETOS.map((p) => `Read(${p})`), "Edit(**/.env*)", "Write(**/.env*)"];

export function buildProArgs({ role, model = null, repo, approved = [], resume = null, maxTurns = 40 }) {
  const escribe = role === "programar";
  const args = ["-p", "--output-format", "stream-json", "--verbose"];
  if (resume) args.push("--resume", resume);
  args.push("--permission-mode", escribe ? "acceptEdits" : "default");
  args.push("--allowedTools", [...(escribe ? LEER_ESCRIBIR : SOLO_LEER), ...approved].join(","));
  const bloqueadas = [...PRIVADOS_CLAUDE, ...(escribe ? [] : ["Edit", "Write", "MultiEdit", "Bash", "PowerShell"])];
  args.push("--disallowedTools", bloqueadas.join(","));
  args.push("--max-turns", String(maxTurns));
  args.push("--model", model || PRO_MODELOS[role] || "sonnet");
  return args; // el cwd del proceso es el repo (no se usa --add-dir)
}

// Directo: stdin =los bytes EXACTOS del texto guardado (sin trim, sin encabezado, sin cambiar saltos de línea).
// Preparar: el pedido original va íntegro dentro de un bloque, seguido del plan que preparó el modelo gratis.
export function buildStdin(task) {
  if (task.mode !== "preparar" || !task.prepared) return Buffer.from(task.text, "utf8");
  const p = task.prepared;
  const partes = ["Pedido original del señor:", task.text, "", `Resumen: ${p.resumen || ""}`];
  if (p.pasos?.length) partes.push("Pasos sugeridos:", ...p.pasos.map((s, i) => `${i + 1}. ${s}`));
  if (p.preguntas?.length) partes.push("Dudas por aclarar (si bloquean, dilo en vez de adivinar):", ...p.preguntas.map((s) => `- ${s}`));
  return Buffer.from(partes.join("\n"), "utf8");
}
