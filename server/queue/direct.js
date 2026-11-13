// Modo Directo a Claude: detecta la orden y guarda el texto EXACTO, sin pasar por ningún modelo.
// No se hace trim, ni se normalizan saltos de línea ni Unicode. La hora va solo en header_json.

// Disparadores: "/claude", "díselo a Claude", "tal cual" (con "Jarvis," opcional delante).
// Tras el disparador se quita solo un separador (":" o "," y UN espacio o salto); lo demás queda intacto.
const TRIGGER = /^(?:jarvis[,.]?[ \t]+)?(?:\/claude|d[ií]selo[ \t]+a[ \t]+claude|tal[ \t]+cual)[:,]?(?:\s|$)/i;

export function detectDirect(text) {
  const s = String(text ?? "");
  const m = TRIGGER.exec(s);
  if (!m) return { direct: false, text: s };
  return { direct: true, text: s.slice(m[0].length), trigger: m[0] };
}

export function createDirect({ tasks }) {
  return {
    detectDirect,
    // Guarda tal cual el texto recibido (sin detección).
    enqueue({ userId, text, source = "texto", extraHeader = {} }) {
      return tasks.create({ userId, rawText: text, mode: "directo", header: { source, ...extraHeader } });
    },
  };
}
