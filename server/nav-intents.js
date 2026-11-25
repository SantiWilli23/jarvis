// Navegador de Claude (docs/NAV.md): solo frases EXPLÍCITAS y ancladas al inicio. "busca X" a secas no coincide.
const INICIO = "^\\s*[¡¿]?(?:(?:oye\\s+)?jarvis[,.:]?\\s+)?(?:(?:por favor|porfa),?\\s+)?(?:(?:puedes|podrias)\\s+)?";
const IA = new RegExp(`${INICIO}(?:pregunta(?:le|r|rle)?)\\s+(?:a|en)\\s+(chat\\s?gpt|gemini|perplexity|grok|claude(?!\\s+code))\\b`);
const GOOGLE = new RegExp(`${INICIO}busca(?:me|r|rme)?\\s+(?:en\\s+google|con\\s+el\\s+navegador)\\b`);

// Minúsculas y sin tildes, carácter a carácter: las posiciones siguen valiendo en el texto original.
const plano = (s) => s.split("").map((c) => c.normalize("NFD")[0].toLowerCase()[0]).join("");

// Devuelve { tipo, sitio, consulta } o null. La consulta conserva el texto original (puede venir vacía).
export function parseNavIntent(text) {
  const t = String(text ?? "").normalize("NFC");
  const p = plano(t);
  const ia = IA.exec(p);
  const m = ia || GOOGLE.exec(p);
  if (!m) return null;
  const consulta = t.slice(m[0].length).replace(/^[\s,:;.]+/, "").trim();
  return ia ? { tipo: "preguntar_ia", sitio: ia[1].replace(/\s/g, ""), consulta } : { tipo: "buscar_google", sitio: "google", consulta };
}
