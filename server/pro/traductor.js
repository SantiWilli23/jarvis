// Traductor Pro web (Groq): funciones puras al estilo de coordinator.js. Acciones cerradas; Groq NO tiene
// campos de repo ni rama, y nunca puede enviar, vincular, fusionar ni aprobar.
import { filtrar, cita } from "./prompts.js";

export const TIPOS = ["hablar", "preguntar", "redactar", "parar"];
export const SUGERIDOS = ["claude_web", "jules", "ambos"]; // los extras (chatgpt/grok/perplexity) solo los pide el usuario
const txt = (x, max) => (typeof x === "string" ? x.trim().slice(0, max) : "");

function parseJson(x) {
  const m = String(x ?? "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { const o = JSON.parse(m[0]); return o && typeof o === "object" && !Array.isArray(o) ? o : null; } catch { return null; }
}
function norm(a) {
  if (!a || typeof a !== "object" || !TIPOS.includes(a.tipo)) return null;
  if (a.tipo === "hablar" || a.tipo === "preguntar") { const t = txt(a.texto, 2000); return t ? { tipo: a.tipo, texto: t } : null; }
  if (a.tipo === "redactar") {
    const prompt = txt(a.prompt, 5000);
    if (!prompt) return null;
    const criterios = (Array.isArray(a.criterios) ? a.criterios : []).map((c) => txt(c, 300)).filter(Boolean).slice(0, 6);
    return { tipo: "redactar", destino_sugerido: SUGERIDOS.includes(a.destino_sugerido) ? a.destino_sugerido : "claude_web", prompt, criterios }; // repo/rama de Groq se ignoran
  }
  return { tipo: "parar" };
}
export function parseAcciones(raw) {
  const o = parseJson(raw);
  if (!o || !Array.isArray(o.acciones)) return null;
  const acciones = o.acciones.map(norm).filter(Boolean);
  return acciones.length ? { acciones, resumen: txt(o.resumen, 1500) } : null;
}
// Una redacción como máximo; tras preguntar o parar no se ejecuta nada más. limite: sin más preguntas.
export function validar(acciones, { limite = false, soloHablar = false } = {}) {
  const out = []; let redacto = false;
  for (const a of acciones) {
    if (soloHablar && a.tipo !== "hablar") continue;
    if (a.tipo === "preguntar" && limite) continue;
    if (a.tipo === "redactar") { if (redacto) continue; redacto = true; }
    out.push(a);
    if (a.tipo === "preguntar" || a.tipo === "parar") break;
  }
  return out.slice(0, 3);
}
const nom = { jarvis: "Jarvis", usuario: "Usuario" };
// Lo único que ve Groq: conversación, NOMBRES de archivo del árbol (filtrados) y nada más.
export function contextoTraductor({ thread, msgs, archivos = [] }) {
  const hist = msgs.slice(-14).filter((m) => ["texto", "coordinador"].includes(m.kind)).map((m) => filtrar(`${nom[m.author] || m.author}: ${m.text}`, 1500)).join("\n");
  const nombres = archivos.slice(0, 300).map((f) => filtrar(f, 120)).join("\n");
  return `Hilo: ${filtrar(thread.title, 80)}
${thread.resumen ? `Resumen previo: ${filtrar(thread.resumen, 1500)}\n` : ""}Conversación reciente:
${hist}
${cita("GitHub", `Archivos del repositorio (solo nombres):\n${nombres || "(no disponible)"}`, 6000)}`;
}
