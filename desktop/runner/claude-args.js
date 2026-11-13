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
  args.push("--max-turns", String(maxTurns));
  if (model) args.push("--model", model);
  if (task?.header?.dictated_at && !resume) {
    args.push("--append-system-prompt", `Contexto: el señor dictó este pedido el ${task.header.dictated_at}. Respóndele en español.`);
  }
  return args;
}

// Directo: stdin = los bytes EXACTOS del texto guardado (sin trim, sin encabezado, sin cambiar saltos de línea).
// Preparar: el pedido original va íntegro dentro de un bloque, seguido del plan que preparó el modelo gratis.
export function buildStdin(task) {
  if (task.mode !== "preparar" || !task.prepared) return Buffer.from(task.text, "utf8");
  const p = task.prepared;
  const partes = ["Pedido original del señor:", task.text, "", `Resumen: ${p.resumen || ""}`];
  if (p.pasos?.length) partes.push("Pasos sugeridos:", ...p.pasos.map((s, i) => `${i + 1}. ${s}`));
  if (p.preguntas?.length) partes.push("Dudas por aclarar (si bloquean, dilo en vez de adivinar):", ...p.preguntas.map((s) => `- ${s}`));
  return Buffer.from(partes.join("\n"), "utf8");
}
