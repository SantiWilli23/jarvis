// Modo Preparar: el modelo gratis ordena el pedido en pasos y preguntas antes de mandarlo a Claude.
// El texto original se conserva intacto en raw_text; la preparación va aparte en prepared_json.
const SISTEMA = `Eres el preparador de tareas de Jarvis. Responde SOLO con un objeto JSON:
{"resumen": "una frase", "pasos": ["paso 1", "paso 2"], "preguntas": ["pregunta si falta información"]}
Sin texto fuera del JSON.`;

export function parsePrepared(text, original) {
  try {
    const m = /\{[\s\S]*\}/.exec(String(text));
    const j = JSON.parse(m ? m[0] : text);
    return {
      resumen: String(j.resumen || "").slice(0, 300),
      pasos: Array.isArray(j.pasos) ? j.pasos.map(String).slice(0, 12) : [],
      preguntas: Array.isArray(j.preguntas) ? j.preguntas.map(String).slice(0, 6) : [],
    };
  } catch {
    return { resumen: String(original).slice(0, 120), pasos: [String(original).slice(0, 300)], preguntas: [] };
  }
}

export function createPrepare({ router, tasks }) {
  return {
    async prepare({ userId, text, isPrivate = false, reviewFirst = true, source = "texto", engine = "claude" }) {
      const r = await router.route({ userId, kind: "accion_pc", isPrivate, system: SISTEMA, messages: [{ role: "user", content: text }] });
      const prepared = r.ok
        ? { ...parsePrepared(r.text, text), por: r.provider }
        : { resumen: String(text).slice(0, 120), pasos: [String(text).slice(0, 300)], preguntas: [], por: null, sin_cuota: true };
      return tasks.create({ userId, rawText: text, mode: "preparar", prepared, reviewFirst, engine, header: { source } });
    },
  };
}
