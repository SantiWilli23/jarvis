// Pro usa solo Claude: programa Sonnet y revisa Opus (el verificador sigue siendo otra pasada, con otro modelo).
// Se conserva el tipo de tarea (task_kind) por heurística.
const RULES = [
  ["ui", /\b(css|html|ui|interfaz|pantalla|bot[oó]n|dise[ñn]o|estilos?|responsive|animaci[oó]n|frontend|front-end|landing|colores?|layout|web\/)\b/i],
  ["docs", /\b(readme|documentaci[oó]n|docs?|comentarios?|traduc\w+|texto|copy)\b/i],
  ["bug", /\b(bug|error|falla|arregla|no funciona|crash|excepci[oó]n|fix)\b/i],
  ["refactor", /\b(refactor\w*|reestructura|limpia|optimiza|rendimiento|migra\w*)\b/i],
  ["seguridad", /\b(seguridad|auth|autenticaci[oó]n|permisos|cifrad\w+|vulnerab\w+|sql|backend|servidor|api|base de datos)\b/i],
  ["tests", /\b(tests?|pruebas?|cobertura)\b/i],
  ["feature", /\b(a[ñn]ade|agrega|crea|implementa|nueva?|feature|funci[oó]n)\b/i],
];

export function heuristic(text) {
  const kinds = RULES.filter(([, re]) => re.test(text)).map(([k]) => k);
  return { task_kind: kinds[0] || "general", engine: "claude", tie: false, kinds };
}

export async function classifyTask(text) {
  const h = heuristic(String(text || ""));
  return { task_kind: h.task_kind, programmer: "claude", verifier: "claude", by: "reglas" };
}
