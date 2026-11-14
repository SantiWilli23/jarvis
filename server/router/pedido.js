// Detecta, de forma determinista y anclada, cuando el usuario pide expresamente a Gemini.
// Solo al inicio ("pregúntale a Gemini, ...") o al final ("... con Gemini"). Nunca en mitad de frase.
const INICIO = /^\s*(?:jarvis[,.]?\s+)?(?:preg[uú]ntale|pregunta|dile)\s+a\s+(?:gemini|google)\b[,:]?\s*/i;
const FINAL = /[\s,]*\b(?:con|usando|usa)\s+(?:gemini|google)[.?!]*\s*$/i;

export function detectPedidoGemini(text) {
  const t = String(text ?? "");
  let m = INICIO.exec(t);
  if (m) { const rest = t.slice(m[0].length).trim(); return rest ? { pedido: true, text: rest } : { pedido: false, text: t }; }
  m = FINAL.exec(t);
  if (m) { const rest = t.slice(0, m.index).trim(); return rest ? { pedido: true, text: rest } : { pedido: false, text: t }; }
  return { pedido: false, text: t };
}
