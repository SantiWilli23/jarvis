// Navegador de Claude (docs/NAV.md): solo frases EXPLÍCITAS y ancladas al inicio. "busca X" a secas no coincide.
const INICIO = "^\\s*[¡¿]?(?:(?:oye\\s+)?jarvis[,.:]?\\s+)?(?:(?:por favor|porfa),?\\s+)?(?:(?:puedes|podrias)\\s+)?";
const IA = new RegExp(`${INICIO}(?:pregunta(?:le|r|rle)?)\\s+(?:a|en)\\s+(chat\\s?gpt|gemini|perplexity|grok|claude(?!\\s+code))\\b`);
// Seguir el chat de Claude: "háblale/dile a Claude", "sigue con Claude"; "chat nuevo con Claude" empieza otro.
const CLAUDE_NUEVO = new RegExp(`${INICIO}(?:(?:abre|empieza|inicia|crea)\\s+)?(?:un\\s+)?(?:chat\\s+nuevo|nuevo\\s+chat)\\s+con\\s+(claude)(?!\\s+code)\\b`);
const CLAUDE_SIGUE = new RegExp(`${INICIO}(?:(?:hablale|dile)\\s+a|(?:sigue|continua)(?:\\s+(?:hablando|conversando))?\\s+con)\\s+(claude)(?!\\s+code)\\b`);
const GOOGLE = new RegExp(`${INICIO}busca(?:me|r|rme)?\\s+(?:en\\s+google|con\\s+el\\s+navegador)\\b`);
const INVESTIGA = new RegExp(`${INICIO}investiga(?:me|r|rme)?\\b`);
// "investiga en mi PC ..." es trabajo para el PC, no una búsqueda en la web.
const MI_PC = /\b(?:mi|este|en el)\s+(?:pc|ordenador|computadora|computador|compu|portatil)\b/;
// "muéstrame el navegador" solo cuenta al principio o al final de la orden: en medio es parte de la consulta.
const VER_INICIO = /^\s*(?:(?:oye\s+)?jarvis[,.:]?\s+)?muestrame\s+el\s+navegador\s*(?:[,;.:]\s*(?:y\s+)?|\s+y\s+)/;
const VER_FINAL = /(?:\s*[,;.]\s*(?:y\s+)?|\s+y\s+)muestrame\s+el\s+navegador\s*[.!]*\s*$/;

// Minúsculas y sin tildes, carácter a carácter: las posiciones siguen valiendo en el texto original.
const plano = (s) => s.split("").map((c) => c.normalize("NFD")[0].toLowerCase()[0]).join("");

// Devuelve { tipo, sitio, consulta, capturas? } o null. La consulta conserva el texto original (puede venir vacía).
export function parseNavIntent(text) {
  let t = String(text ?? "").normalize("NFC");
  let capturas = false;
  for (const re of [VER_INICIO, VER_FINAL]) {
    const v = re.exec(plano(t));
    if (v) { t = t.slice(0, v.index) + t.slice(v.index + v[0].length); capturas = true; }
  }
  const p = plano(t);
  const nuevo = CLAUDE_NUEVO.exec(p);
  const ia = nuevo || IA.exec(p) || CLAUDE_SIGUE.exec(p);
  const google = ia ? null : GOOGLE.exec(p);
  const inv = ia || google ? null : INVESTIGA.exec(p);
  const m = ia || google || inv;
  if (!m || (inv && MI_PC.test(p))) return null;
  const consulta = t.slice(m[0].length).replace(/^[\s,:;.]+/, "").trim();
  const out = ia ? { tipo: "preguntar_ia", sitio: ia[1].replace(/\s/g, ""), consulta } : { tipo: inv ? "investigar" : "buscar_google", sitio: "google", consulta };
  if (nuevo) out.nuevo = true;
  return capturas ? { ...out, capturas } : out;
}
