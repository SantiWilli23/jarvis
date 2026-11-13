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

// Planificador de Gemini: `planner` = proveedor de la API de Google con el modelo de planear (Hydrogen, nivel gratis).
// Funciona con el PC apagado. NUNCA recibe contenido privado.
export function createPrepare({ router, tasks, planner = null, privacy = null, bus = null }) {
  async function planWithGemini({ userId, text, isPrivate }) {
    if (!planner || isPrivate) return null;
    privacy?.assert("gemini", isPrivate);
    try {
      const r = await planner.chat({ system: SISTEMA, messages: [{ role: "user", content: text }] });
      if (!String(r.text || "").trim()) return null;
      bus?.emit("pc.using", { userId, id: "gemini" });
      return { ...parsePrepared(r.text, text), por: planner.model };
    } catch { return null; } // sin cuota o sin red: planea la cadena normal
  }
  return {
    async prepare({ userId, text, isPrivate = false, reviewFirst = true, source = "texto", engine = "claude" }) {
      if (engine === "gemini" && isPrivate) throw new Error("privado_no_gemini");
      const hydrogen = engine === "gemini" ? await planWithGemini({ userId, text, isPrivate }) : null;
      if (hydrogen) return tasks.create({ userId, rawText: text, mode: "preparar", prepared: hydrogen, reviewFirst, engine, header: { source } });
      const r = await router.route({ userId, kind: "accion_pc", isPrivate, system: SISTEMA, messages: [{ role: "user", content: text }] });
      const prepared = r.ok
        ? { ...parsePrepared(r.text, text), por: r.provider }
        : { resumen: String(text).slice(0, 120), pasos: [String(text).slice(0, 300)], preguntas: [], por: null, sin_cuota: true };
      return tasks.create({ userId, rawText: text, mode: "preparar", prepared, reviewFirst, engine, header: { source } });
    },
  };
}
