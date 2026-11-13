// Enruta por tipo de tarea: heurística y, si hay proveedor de texto barato, desempata con él.
// Empate o duda -> empieza Claude.
const RULES = [
  ["ui", "gemini", /\b(css|html|ui|interfaz|pantalla|bot[oó]n|dise[ñn]o|estilos?|responsive|animaci[oó]n|frontend|front-end|landing|colores?|layout|web\/)\b/i],
  ["docs", "gemini", /\b(readme|documentaci[oó]n|docs?|comentarios?|traduc\w+|texto|copy)\b/i],
  ["bug", "claude", /\b(bug|error|falla|arregla|no funciona|crash|excepci[oó]n|fix)\b/i],
  ["refactor", "claude", /\b(refactor\w*|reestructura|limpia|optimiza|rendimiento|migra\w*)\b/i],
  ["seguridad", "claude", /\b(seguridad|auth|autenticaci[oó]n|permisos|cifrad\w+|vulnerab\w+|sql|backend|servidor|api|base de datos)\b/i],
  ["tests", "claude", /\b(tests?|pruebas?|cobertura)\b/i],
  ["feature", null, /\b(a[ñn]ade|agrega|crea|implementa|nueva?|feature|funci[oó]n)\b/i],
];

export function heuristic(text) {
  const score = { claude: 0, gemini: 0 };
  const kinds = [];
  for (const [kind, eng, re] of RULES) if (re.test(text)) { kinds.push(kind); if (eng) score[eng]++; }
  const task_kind = kinds[0] || "general";
  const engine = score.gemini > score.claude ? "gemini" : "claude"; // empate -> Claude
  return { task_kind, engine, tie: score.gemini === score.claude && kinds.length > 0 && score.gemini > 0, kinds };
}

// textProvider(prompt) -> string opcional (modelo barato). Solo se consulta en empate real.
export async function classifyTask(text, { textProvider } = {}) {
  const h = heuristic(String(text || ""));
  let engine = h.engine, by = "reglas";
  if (h.tie && textProvider) {
    try {
      const r = String(await textProvider(`Elige quién programa mejor esta tarea. Responde solo "claude" o "gemini".\nTarea: ${String(text).slice(0, 600)}`)).toLowerCase();
      if (/gemini/.test(r) && !/claude/.test(r)) { engine = "gemini"; by = "modelo"; }
    } catch { /* si falla, empieza Claude */ }
  }
  return { task_kind: h.task_kind, programmer: engine, verifier: engine === "claude" ? "gemini" : "claude", by };
}
