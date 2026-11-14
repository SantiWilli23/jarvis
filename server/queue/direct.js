// Modo Directo a Claude (y prefijo Gemini): detecta la orden y guarda el texto EXACTO, sin pasar por ningún modelo.
// No se hace trim, ni se normalizan saltos de línea ni Unicode. La hora va solo en header_json.

// Disparadores explícitos al INICIO: "/claude", "díselo a Claude:", "directo a Claude:", "tal cual:" y, para
// Gemini, "/gemini", "díselo a Gemini:", "directo a Gemini:" (con "Jarvis," opcional delante). Gemini ya no encola
// nada: el chat quita el prefijo y contesta con el proveedor gemini (API).
// Las frases exigen los dos puntos, así que "dímelo tal cual es" o "tal cual lo dijo" no activan nada.
// Tras el disparador se quita solo UN espacio o salto; lo demás queda intacto.
const TRIGGER = /^(?:jarvis[,.]?[ \t]+)?(?:\/(claude|gemini)[:,]?|(?:d[ií]selo[ \t]+a[ \t]+(claude|gemini)|directo[ \t]+a[ \t]+(claude|gemini)|tal[ \t]+cual)[ \t]*:)(?:\s|$)/i;

export function detectDirect(text) {
  const s = String(text ?? "");
  const m = TRIGGER.exec(s);
  if (!m) return { direct: false, text: s };
  const engine = (m[1] || m[2] || m[3] || "claude").toLowerCase();
  return { direct: true, text: s.slice(m[0].length), trigger: m[0], engine };
}

export function createDirect({ tasks }) {
  return {
    detectDirect,
    // Guarda tal cual el texto recibido (sin detección).
    enqueue({ userId, text, source = "texto", extraHeader = {}, engine = "claude" }) {
      return tasks.create({ userId, rawText: text, mode: "directo", engine, header: { source, ...extraHeader } });
    },
  };
}
